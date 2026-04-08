import { expect, test } from "@playwright/test";

const CLUSTER_ID = "dev";
const SCOPE_KEY = `${CLUSTER_ID}::overview::all::name::none`;
const WORKLOAD_CACHE_KEYS = [
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::overview::all::none`)}`,
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::overview::all::name`)}`,
];
const WORKLOAD_OVERVIEW_SNAPSHOT = JSON.stringify({
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

test.describe("overview shell non-blocking", () => {
  test("renders the overview shell before background refresh resolves", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(
      ([scopeKey, workloadCacheKeys, workloadOverviewSnapshot]) => {
        const internals = (window as typeof window & { __TAURI_INTERNALS__?: { invoke?: unknown } })
          .__TAURI_INTERNALS__;
        if (!internals || typeof internals.invoke !== "function") {
          (
            window as typeof window & {
              __TAURI_INTERNALS__?: { invoke: (_cmd: string) => Promise<never> };
            }
          ).__TAURI_INTERNALS__ = {
            invoke: async (_cmd: string) =>
              await new Promise<never>(() => {
                // Keep background refresh pending to validate shell-first rendering.
              }),
          };
        }

        window.localStorage.setItem(
          `dashboard.overview.snapshot.v1:${encodeURIComponent(scopeKey)}`,
          JSON.stringify({
            schemaVersion: 1,
            scopeKey,
            cachedAt: Date.now() - 2_000,
            eventsHydrated: false,
            certificatesHydrated: false,
            lastEventsSuccessAt: 0,
            lastCertificatesSuccessAt: 0,
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
            usageMetricsLastLoadedAt: 0,
            accessProfile: null,
            accessProfileError: null,
          }),
        );
        for (const key of workloadCacheKeys) {
          window.localStorage.setItem(key, workloadOverviewSnapshot);
        }
      },
      [SCOPE_KEY, WORKLOAD_CACHE_KEYS, WORKLOAD_OVERVIEW_SNAPSHOT],
    );

    const page = await context.newPage();
    await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=overview`);

    // Runtime status shows in compact mode (default) - verify source badge is visible
    await expect(page.getByText("Cached").first()).toBeVisible();
  });
});
