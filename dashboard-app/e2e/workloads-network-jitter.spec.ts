import { expect, test } from "@playwright/test";

const CLUSTER_ID = "dev";
const WORKLOAD = "deployments";
const CACHE_KEYS = [
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::${WORKLOAD}::all::none`)}`,
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::${WORKLOAD}::all::name`)}`,
];

const payload = [
  {
    metadata: {
      uid: "dep-jitter-1",
      name: "cached-jitter-deployment",
      namespace: "default",
      creationTimestamp: new Date().toISOString(),
      resourceVersion: "900",
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: "cached-jitter-deployment" } },
      template: {
        metadata: { labels: { app: "cached-jitter-deployment" } },
        spec: { containers: [{ name: "main", image: "nginx:1.27" }] },
      },
    },
    status: {
      readyReplicas: 1,
      availableReplicas: 1,
      replicas: 1,
      updatedReplicas: 1,
    },
  },
];

test.describe("workloads network jitter", () => {
  test("keeps cached render instant while refresh is slow/failing", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(
      ([keys, data]) => {
        const snapshot = JSON.stringify({
          schemaVersion: 1,
          cachedAt: Date.now(),
          data,
        });
        for (const key of keys) {
          window.localStorage.setItem(key, snapshot);
        }
        (
          window as typeof window & {
            __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<never> };
          }
        ).__TAURI_INTERNALS__ = {
          invoke: async () => {
            await new Promise((resolve) => setTimeout(resolve, 1_200));
            throw new Error("chaos-network-jitter");
          },
        };
      },
      [CACHE_KEYS, payload],
    );

    const page = await context.newPage();
    const startedAt = Date.now();
    await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=${WORKLOAD}`);
    await expect(page.getByText(/^(Cached|Stale cache) ·/i).first()).toBeVisible();
    await expect(page.getByText(/cached-jitter-deployment/i)).toBeVisible();
    const firstPaintMs = Date.now() - startedAt;
    expect(firstPaintMs).toBeLessThan(3_500);
  });
});
