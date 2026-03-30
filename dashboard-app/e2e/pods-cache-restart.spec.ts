import { expect, test } from "@playwright/test";

const CLUSTER_ID = "dev";

const WORKLOAD_CACHE_KEYS = [
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::pods::all::none`)}`,
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::pods::all::name`)}`,
];

const PODS_SCOPE_KEYS = [`${CLUSTER_ID}::all`];

const podsPayload = [
  {
    metadata: {
      uid: "pod-cached-1",
      name: "cached-pod",
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
      nodeName: "node-a",
    },
  },
];

const workloadPodsSnapshot = JSON.stringify({
  schemaVersion: 1,
  cachedAt: Date.now(),
  data: podsPayload,
});

const podsSnapshot = (scopeKey: string) =>
  JSON.stringify({
    schemaVersion: 1,
    scopeKey,
    cachedAt: Date.now(),
    pods: podsPayload,
  });

const PODS_SEED_ENTRIES = PODS_SCOPE_KEYS.map((scopeKey) => ({
  storageKey: `dashboard.pods.snapshot.v1:${encodeURIComponent(scopeKey)}`,
  value: podsSnapshot(scopeKey),
}));

test.describe("pods cache restart", () => {
  test("keeps instant cached pods render after page restart", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(
      ([workloadKeys, workloadValue, podsEntries]) => {
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
                // Keep background refresh pending and validate cached-first render.
              }),
          };
        }
        for (const workloadKey of workloadKeys) {
          window.localStorage.setItem(workloadKey, workloadValue);
        }
        for (const entry of podsEntries) {
          window.localStorage.setItem(entry.storageKey, entry.value);
        }
      },
      [WORKLOAD_CACHE_KEYS, workloadPodsSnapshot, PODS_SEED_ENTRIES],
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

    await page.close();

    const reopened = await context.newPage();
    await reopened.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=pods`);
    await expect(
      reopened
        .getByText(
          /(Cached|Stale cache) · .*(Refreshing|Ready|Refresh failed, showing last snapshot)/i,
        )
        .first(),
    ).toBeVisible();
    await expect(reopened.getByText(/Watcher: (On|Off)/)).toBeVisible();
  });
});
