import { expect, test } from "@playwright/test";

// F1 (trust): when the cluster is unreachable, the last stored health check is
// still served from cache and reads "healthy". The live probes fail though, so
// the Overview must warn that it is showing last-known state instead of
// silently presenting the stale score as live.

const CLUSTER_ID = "dev";
const CONNECTION_ERROR =
  "error sending request: dial tcp 127.0.0.1:6443: connect: connection refused";

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
    eventsRows: [],
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

test.describe("overview unreachable cluster", () => {
  test("warns instead of presenting stale health as live when the cluster is unreachable", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await context.addInitScript(
      ([workloadKeys, workloadValue, overviewEntries, connectionError]) => {
        // Every live cluster probe fails with a connection-level error, mirroring
        // an unreachable API server while cached snapshots remain in storage.
        (
          window as typeof window & {
            __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<never> };
          }
        ).__TAURI_INTERNALS__ = {
          invoke: async (_cmd: string) => {
            throw new Error(connectionError as string);
          },
        };
        for (const workloadKey of workloadKeys as string[]) {
          window.localStorage.setItem(workloadKey, workloadValue as string);
        }
        for (const entry of overviewEntries as Array<{ storageKey: string; value: string }>) {
          window.localStorage.setItem(entry.storageKey, entry.value);
        }
      },
      [WORKLOAD_CACHE_KEYS, workloadOverviewSnapshot, OVERVIEW_SEED_ENTRIES, CONNECTION_ERROR],
    );

    const page = await context.newPage();
    await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=overview`);

    // The trust signal: a prominent unreachable banner naming the last-known state.
    const banner = page.getByTestId("overview-cluster-unreachable");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Cluster unreachable");
    await expect(banner).toContainText(/last known state/i);

    // The misleading green "Live · Updated" chip must NOT be shown.
    await expect(page.getByText(/^Live · Updated/)).toHaveCount(0);

    // And the unreachable status chip replaces it.
    await expect(page.getByTestId("overview-unreachable-chip")).toBeVisible();

    await context.close();
  });
});
