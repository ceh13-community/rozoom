import { expect, test } from "@playwright/test";

const CLUSTER_ID = "dev";
const WORKLOAD = "configmaps";
const CACHE_KEYS = [
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::${WORKLOAD}::all::none`)}`,
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::${WORKLOAD}::all::name`)}`,
];

const configmapsPayload = [
  {
    metadata: {
      uid: "cm-cached-1",
      name: "cached-config",
      namespace: "default",
      creationTimestamp: new Date().toISOString(),
      resourceVersion: "100",
    },
    data: {
      "app.yaml": "replicas: 1",
    },
  },
];

const workloadSnapshot = JSON.stringify({
  schemaVersion: 1,
  cachedAt: Date.now(),
  data: configmapsPayload,
});

test.describe("workloads configmaps cache restart", () => {
  test("renders cached configuration workload instantly after restart", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(
      ([keys, value]) => {
        const internals = (window as typeof window & { __TAURI_INTERNALS__?: { invoke?: unknown } })
          .__TAURI_INTERNALS__;
        if (!internals || typeof internals.invoke !== "function") {
          (
            window as typeof window & {
              __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<never> };
            }
          ).__TAURI_INTERNALS__ = {
            invoke: async (_cmd: string) =>
              await new Promise<never>(() => {
                // keep background refresh pending
              }),
          };
        }
        for (const key of keys) {
          window.localStorage.setItem(key, value);
        }
      },
      [CACHE_KEYS, workloadSnapshot],
    );

    const page = await context.newPage();
    await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=${WORKLOAD}`);
    await expect(page.getByText(/^(Cached|Stale cache) ·/)).toBeVisible();
    await expect(page.getByText(/cached-config/i)).toBeVisible();
    await page.close();

    const reopened = await context.newPage();
    await reopened.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=${WORKLOAD}`);
    await expect(reopened.getByText(/^(Cached|Stale cache) ·/)).toBeVisible();
    await expect(reopened.getByText(/cached-config/i)).toBeVisible();
  });
});
