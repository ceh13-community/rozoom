import { expect, test } from "@playwright/test";

const CLUSTER_ID = "dev";
const WORKLOAD_CACHE_KEYS = [
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::pods::all::none`)}`,
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::pods::all::name`)}`,
];
const PODS_SCOPE_KEY = `${CLUSTER_ID}::all`;

const podsPayload = [
  {
    metadata: {
      uid: "pod-chaos-1",
      name: "chaos-cached-pod",
      namespace: "default",
      ownerReferences: [{ kind: "ReplicaSet" }],
    },
    status: {
      startTime: new Date().toISOString(),
      qosClass: "Burstable",
      containerStatuses: [{ ready: true, restartCount: 2 }],
      phase: "Running",
    },
    spec: {
      nodeName: "node-chaos-a",
    },
  },
];

test.describe("pods chaos cache fallback", () => {
  test("keeps cached pods visible when background refresh fails", async ({ browser }) => {
    const workloadPodsSnapshot = JSON.stringify({
      schemaVersion: 1,
      cachedAt: Date.now(),
      data: podsPayload,
    });
    const podsSnapshotEntry = {
      storageKey: `dashboard.pods.snapshot.v1:${encodeURIComponent(PODS_SCOPE_KEY)}`,
      value: JSON.stringify({
        schemaVersion: 1,
        scopeKey: PODS_SCOPE_KEY,
        cachedAt: Date.now(),
        pods: podsPayload,
      }),
    };

    const context = await browser.newContext();
    await context.addInitScript(
      ([workloadKeys, workloadValue, snapshotEntry]) => {
        (
          window as typeof window & {
            __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<never> };
          }
        ).__TAURI_INTERNALS__ = {
          invoke: async (_cmd: string) => {
            throw new Error("chaos-invoke-error");
          },
        };
        for (const key of workloadKeys) {
          window.localStorage.setItem(key, workloadValue);
        }
        window.localStorage.setItem(snapshotEntry.storageKey, snapshotEntry.value);
      },
      [WORKLOAD_CACHE_KEYS, workloadPodsSnapshot, podsSnapshotEntry],
    );

    const page = await context.newPage();
    await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=pods`);

    await expect(page.getByText(/Cached · .*Refresh failed, showing last snapshot/i)).toBeVisible();
    await expect(page.getByText(/Pod watcher sync failed|chaos-invoke-error/i)).toBeVisible();
    await expect(page.getByText(/No results\.|chaos-cached-pod/i)).toBeVisible();
  });
});
