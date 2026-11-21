import { expect, test } from "@playwright/test";

const CLUSTER_ID = "dev";
const WORKLOAD = "configmaps";
const CACHE_KEYS = [
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::${WORKLOAD}::all::none`)}`,
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::${WORKLOAD}::all::name`)}`,
];

const payload = [
  {
    metadata: {
      uid: "cm-fallback-1",
      name: "cached-fallback-config",
      namespace: "default",
      creationTimestamp: new Date().toISOString(),
      resourceVersion: "100",
    },
    data: {
      "app.yaml": "replicas: 2",
    },
  },
];

test.describe("workloads chaos cache fallback", () => {
  test("keeps cached configmaps visible when refresh fails", async ({ browser }) => {
    const workloadSnapshot = JSON.stringify({
      schemaVersion: 1,
      cachedAt: Date.now(),
      data: payload,
    });

    const context = await browser.newContext();
    await context.addInitScript(
      ([keys, value]) => {
        (
          window as typeof window & {
            __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<never> };
          }
        ).__TAURI_INTERNALS__ = {
          invoke: async () => {
            throw new Error("chaos-workload-refresh-error");
          },
        };
        for (const key of keys) window.localStorage.setItem(key, value);
      },
      [CACHE_KEYS, workloadSnapshot],
    );

    const page = await context.newPage();
    await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=${WORKLOAD}`);
    const freshness = page.getByTestId("list-freshness").first();
    await expect(freshness).toBeVisible();
    // The refresh failed and the rows come from the cache: no watch is connected,
    // so the list says Reconnecting with the time of the cached data, never Live.
    await expect(freshness).toContainText("Reconnecting");
    await expect(freshness).not.toContainText("Live");
    await expect(page.getByText(/cached-fallback-config/i)).toBeVisible();
  });
});
