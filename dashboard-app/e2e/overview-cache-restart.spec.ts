import { expect, test } from "@playwright/test";

const CLUSTER_ID = "dev";
const WORKLOAD_CACHE_KEYS = [
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::overview::all::none`)}`,
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::overview::all::name`)}`,
];
const OVERVIEW_SCOPE_KEYS = [
  `${CLUSTER_ID}::overview::all::name::none`,
  `${CLUSTER_ID}::overview::all::name::all::name`,
];

const workloadOverviewSnapshot = JSON.stringify({
  schemaVersion: 1,
  cachedAt: Date.now(),
  data: {
    pods: { quantity: 3 },
    deployments: { quantity: 1 },
    daemonsets: { quantity: 1 },
    statefulsets: { quantity: 0 },
    replicasets: { quantity: 1 },
    jobs: { quantity: 0 },
    cronjobs: { quantity: 0 },
    nodes: { quantity: 1 },
  },
});

const overviewSnapshot = (scopeKey: string) =>
  JSON.stringify({
    schemaVersion: 1,
    scopeKey,
    cachedAt: Date.now(),
    eventsHydrated: true,
    certificatesHydrated: true,
    lastEventsSuccessAt: Date.now(),
    lastCertificatesSuccessAt: Date.now(),
    eventsRows: [
      {
        uid: "cached-event",
        reason: "BackOff",
        object: "Pod default/demo",
        message: "cached event",
        name: "demo",
        date: "now",
      },
    ],
    certificatesRows: [],
    rotationRows: [],
    warningItems: [],
    eventsError: null,
    certificatesError: null,
    clusterHealth: null,
    clusterHealthError: null,
    usageMetricsError: null,
    cpuAveragePercent: null,
    memoryAveragePercent: null,
    cpuReservedCores: null,
    memoryReservedBytes: null,
    coreMetricsUnavailable: null,
    podCapacity: null,
    providerIds: [],
    usageMetricsLastLoadedAt: Date.now(),
  });
const OVERVIEW_SEED_ENTRIES = OVERVIEW_SCOPE_KEYS.map((scopeKey) => ({
  storageKey: `dashboard.overview.snapshot.v1:${encodeURIComponent(scopeKey)}`,
  value: overviewSnapshot(scopeKey),
}));

test.describe("overview cache restart", () => {
  test("keeps instant cached overview render after page restart", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(
      ([workloadKeys, workloadValue, overviewEntries]) => {
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
                // Keep background refresh in pending state to validate instant cached render path.
              }),
          };
        }
        for (const workloadKey of workloadKeys) {
          window.localStorage.setItem(workloadKey, workloadValue);
        }
        for (const entry of overviewEntries) {
          window.localStorage.setItem(entry.storageKey, entry.value);
        }
      },
      [WORKLOAD_CACHE_KEYS, workloadOverviewSnapshot, OVERVIEW_SEED_ENTRIES],
    );

    const page = await context.newPage();
    await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=overview`);
    await expect(page.getByText(/^Cached · .*Refreshing(?:\.\.\.)?$/i).first()).toBeVisible();

    await page.close();

    const reopened = await context.newPage();
    await reopened.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=overview`);
    await expect(reopened.getByText(/^Cached · .*Refreshing(?:\.\.\.)?$/i).first()).toBeVisible();
  });
});
