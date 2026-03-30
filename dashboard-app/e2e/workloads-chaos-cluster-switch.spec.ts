import { expect, test } from "@playwright/test";

const CLUSTER_A = "dev";
const CLUSTER_B = "prod";
const WORKLOAD = "deployments";

function cacheKeys(clusterId: string) {
  return [
    `dashboard.workloads.cache.v1:${encodeURIComponent(`${clusterId}::${WORKLOAD}::all::none`)}`,
    `dashboard.workloads.cache.v1:${encodeURIComponent(`${clusterId}::${WORKLOAD}::all::name`)}`,
  ];
}

function deploymentSnapshot(clusterId: string, name: string) {
  return JSON.stringify({
    schemaVersion: 1,
    cachedAt: Date.now(),
    data: [
      {
        metadata: {
          uid: `${clusterId}-${name}`,
          name,
          namespace: "default",
          creationTimestamp: new Date().toISOString(),
          resourceVersion: "100",
        },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: name } },
          template: {
            metadata: { labels: { app: name } },
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
    ],
  });
}

test.describe("workloads chaos cluster switch", () => {
  test("keeps cached deployments while switching clusters under refresh failures", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await context.addInitScript(
      ([keysA, keysB, valueA, valueB]) => {
        (
          window as typeof window & {
            __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<never> };
          }
        ).__TAURI_INTERNALS__ = {
          invoke: async () => {
            throw new Error("chaos-refresh-error");
          },
        };
        for (const key of keysA) window.localStorage.setItem(key, valueA);
        for (const key of keysB) window.localStorage.setItem(key, valueB);
      },
      [
        cacheKeys(CLUSTER_A),
        cacheKeys(CLUSTER_B),
        deploymentSnapshot(CLUSTER_A, "cached-deployment-dev"),
        deploymentSnapshot(CLUSTER_B, "cached-deployment-prod"),
      ],
    );

    const page = await context.newPage();
    await page.goto(`/dashboard/clusters/${CLUSTER_A}?workload=${WORKLOAD}`);
    await expect(page.getByText(/^(Cached|Stale cache) ·/i).first()).toBeVisible();
    await expect(page.getByText(/cached-deployment-dev/i)).toBeVisible();

    await page.goto(`/dashboard/clusters/${CLUSTER_B}?workload=${WORKLOAD}`);
    await expect(page.getByText(/^(Cached|Stale cache) ·/i).first()).toBeVisible();
    await expect(page.getByText(/cached-deployment-prod/i)).toBeVisible();
  });
});
