import { expect, test } from "@playwright/test";

const CLUSTER_ID = "dev";

const WORKLOAD_CACHE_KEYS = [
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::pods::all::none`)}`,
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::pods::all::name`)}`,
];
const PODS_SCOPE_KEY = `${CLUSTER_ID}::all`;

function buildPods(count: number) {
  return Array.from({ length: count }, (_, idx) => ({
    metadata: {
      uid: `pod-${idx}`,
      name: `pod-${idx}`,
      namespace: idx % 2 === 0 ? "default" : "kube-system",
      ownerReferences: [{ kind: "ReplicaSet" }],
    },
    status: {
      startTime: new Date(Date.now() - idx * 1000).toISOString(),
      qosClass: "Burstable",
      containerStatuses: [{ ready: true, restartCount: idx % 3 }],
      phase: "Running",
    },
    spec: {
      nodeName: `node-${idx % 12}`,
    },
  }));
}

test.describe("pods stress render", () => {
  test("renders cached large pods dataset with bounded visible rows", async ({ browser }) => {
    const pods = buildPods(2500);
    const workloadPodsSnapshot = JSON.stringify({
      schemaVersion: 1,
      cachedAt: Date.now(),
      data: pods,
    });
    const podsSnapshotEntry = {
      storageKey: `dashboard.pods.snapshot.v1:${encodeURIComponent(PODS_SCOPE_KEY)}`,
      value: JSON.stringify({
        schemaVersion: 1,
        scopeKey: PODS_SCOPE_KEY,
        cachedAt: Date.now(),
        pods,
      }),
    };

    const context = await browser.newContext();
    await context.addInitScript(
      ([workloadKeys, workloadValue, snapshotEntry]) => {
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
                // Keep background refresh pending to stress cached render path.
              }),
          };
        }
        for (const key of workloadKeys) {
          window.localStorage.setItem(key, workloadValue);
        }
        window.localStorage.setItem(snapshotEntry.storageKey, snapshotEntry.value);
      },
      [WORKLOAD_CACHE_KEYS, workloadPodsSnapshot, podsSnapshotEntry],
    );

    const page = await context.newPage();
    await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=pods`);
    await expect(
      page
        .getByText(
          /(Cached|Stale cache) · .*(Refreshing|Ready|Refresh failed, showing last snapshot)/i,
        )
        .first(),
    ).toBeVisible();
    await expect(page.getByText(/Watcher: (On|Off)/)).toBeVisible();

    const renderedRows = await page.locator("tbody tr").count();
    expect(renderedRows).toBeLessThan(450);
  });
});
