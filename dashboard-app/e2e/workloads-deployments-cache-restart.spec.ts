import { expect, test } from "@playwright/test";

const CLUSTER_ID = "dev";
const CACHE_KEYS = [
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::deployments::all::none`)}`,
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::deployments::all::name`)}`,
];

const deploymentsPayload = [
  {
    metadata: {
      uid: "deploy-cached-1",
      name: "cached-deployment",
      namespace: "default",
      creationTimestamp: new Date().toISOString(),
      resourceVersion: "100",
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: "cached-deployment" } },
      template: {
        metadata: { labels: { app: "cached-deployment" } },
        spec: { containers: [{ name: "main", image: "nginx:stable" }] },
      },
    },
    status: {
      readyReplicas: 1,
      updatedReplicas: 1,
      availableReplicas: 1,
      replicas: 1,
    },
  },
];

const workloadSnapshot = JSON.stringify({
  schemaVersion: 1,
  cachedAt: Date.now(),
  data: deploymentsPayload,
});

test.describe("workloads deployments cache restart", () => {
  test("renders cached deployments instantly after restart", async ({ browser }) => {
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
    await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=deployments`);
    await expect(page.getByText(/^(Cached|Stale cache) ·/i).first()).toBeVisible();
    await expect(page.getByText(/cached-deployment/i)).toBeVisible();
    await page.close();

    const reopened = await context.newPage();
    await reopened.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=deployments`);
    await expect(reopened.getByText(/^(Cached|Stale cache) ·/i).first()).toBeVisible();
    await expect(reopened.getByText(/cached-deployment/i)).toBeVisible();
  });
});
