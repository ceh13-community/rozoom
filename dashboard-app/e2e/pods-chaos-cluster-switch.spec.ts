import { expect, test } from "@playwright/test";

const CLUSTER_A = "dev";
const CLUSTER_B = "prod";

function workloadCacheKeys(clusterId: string) {
  return [
    `dashboard.workloads.cache.v1:${encodeURIComponent(`${clusterId}::pods::all::none`)}`,
    `dashboard.workloads.cache.v1:${encodeURIComponent(`${clusterId}::pods::all::name`)}`,
  ];
}

function podsSnapshotEntry(clusterId: string, podName: string) {
  const scopeKey = `${clusterId}::all`;
  const payload = [
    {
      metadata: {
        uid: `${clusterId}-${podName}`,
        name: podName,
        namespace: "default",
        ownerReferences: [{ kind: "ReplicaSet" }],
      },
      status: {
        startTime: new Date().toISOString(),
        qosClass: "Burstable",
        containerStatuses: [{ ready: true, restartCount: 0 }],
        phase: "Running",
      },
      spec: {
        nodeName: `${clusterId}-node-a`,
      },
    },
  ];
  return {
    workloadValue: JSON.stringify({
      schemaVersion: 1,
      cachedAt: Date.now(),
      data: payload,
    }),
    storageKey: `dashboard.pods.snapshot.v1:${encodeURIComponent(scopeKey)}`,
    value: JSON.stringify({
      schemaVersion: 1,
      scopeKey,
      cachedAt: Date.now(),
      pods: payload,
    }),
  };
}

test.describe("pods chaos cluster switch", () => {
  test("keeps cached pods rendering while switching clusters under failing refresh", async ({
    browser,
  }) => {
    const entryA = podsSnapshotEntry(CLUSTER_A, "pod-dev");
    const entryB = podsSnapshotEntry(CLUSTER_B, "pod-prod");

    const context = await browser.newContext();
    await context.addInitScript(
      ([keysA, keysB, a, b]) => {
        (
          window as typeof window & {
            __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<never> };
          }
        ).__TAURI_INTERNALS__ = {
          invoke: async () => {
            throw new Error("chaos-refresh-error");
          },
        };

        for (const key of keysA) {
          window.localStorage.setItem(key, a.workloadValue);
        }
        for (const key of keysB) {
          window.localStorage.setItem(key, b.workloadValue);
        }
        window.localStorage.setItem(a.storageKey, a.value);
        window.localStorage.setItem(b.storageKey, b.value);
      },
      [workloadCacheKeys(CLUSTER_A), workloadCacheKeys(CLUSTER_B), entryA, entryB],
    );

    const page = await context.newPage();
    await page.goto(`/dashboard/clusters/${CLUSTER_A}?workload=pods`);
    await expect(page.getByText(/Cached · .*Refresh failed, showing last snapshot/i)).toBeVisible();

    await page.goto(`/dashboard/clusters/${CLUSTER_B}?workload=pods`);
    await expect(page.getByText(/Cached · .*Refresh failed, showing last snapshot/i)).toBeVisible();
    await expect(page.getByText(/No results\.|pod-prod/i)).toBeVisible();
  });
});
