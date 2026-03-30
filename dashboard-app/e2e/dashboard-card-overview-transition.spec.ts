import { expect, test } from "@playwright/test";

const CLUSTER_ID = "dev";
const CLUSTER_NAME = "EKS Alpha";
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

test.describe("dashboard card to overview transition", () => {
  test("renders cached overview shell after clicking a dashboard cluster card", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await context.addInitScript(
      ([clusterId, clusterName, scopeKey, workloadCacheKeys, workloadOverviewSnapshot]) => {
        const seededClusters = [
          {
            uuid: clusterId,
            name: clusterName,
            addedAt: new Date("2026-03-14T00:00:00.000Z").toISOString(),
            needsInitialRefreshHint: false,
          },
        ];
        const clusterStoreKey = "tauri-store-fallback:clusters.json";
        window.localStorage.setItem(
          clusterStoreKey,
          JSON.stringify({
            clusters: seededClusters,
          }),
        );
        window.localStorage.setItem(
          "dashboard.data-profile.v1",
          JSON.stringify({ profileId: "manual" }),
        );
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

        const storeState = new Map<number, Record<string, unknown>>();
        let nextStoreRid = 1;
        const internals = (
          window as typeof window & {
            __TAURI_INTERNALS__?: { invoke?: (cmd: string, payload?: unknown) => Promise<unknown> };
          }
        ).__TAURI_INTERNALS__;
        if (!internals || typeof internals.invoke !== "function") {
          (
            window as typeof window & {
              __TAURI_INTERNALS__: { invoke: (cmd: string, payload?: unknown) => Promise<unknown> };
            }
          ).__TAURI_INTERNALS__ = {
            invoke: async (cmd: string, payload?: unknown) => {
              if (cmd === "plugin:store|load") {
                const rid = nextStoreRid++;
                storeState.set(rid, { clusters: seededClusters });
                return rid;
              }
              if (cmd === "plugin:store|get") {
                const args = payload as { rid: number; key: string };
                const value = storeState.get(args.rid)?.[args.key];
                return [value ?? null, value !== undefined];
              }
              if (cmd === "plugin:store|set") {
                const args = payload as { rid: number; key: string; value: unknown };
                const snapshot = storeState.get(args.rid) ?? {};
                snapshot[args.key] = args.value;
                storeState.set(args.rid, snapshot);
                return null;
              }
              if (cmd === "plugin:store|save") {
                return null;
              }
              if (cmd === "rozoom:kubectl-proxy") {
                await new Promise<never>(() => {
                  // Keep background refresh pending to validate shell-first rendering.
                });
              }
              return { output: "", errors: "", code: 0, payload };
            },
          };
        }
      },
      [CLUSTER_ID, CLUSTER_NAME, SCOPE_KEY, WORKLOAD_CACHE_KEYS, WORKLOAD_OVERVIEW_SNAPSHOT],
    );

    const page = await context.newPage();
    await page.goto("/dashboard");

    await expect(
      page.getByRole("heading", { name: "Available Kubernetes Clusters" }),
    ).toBeVisible();
    await expect(page.getByText(CLUSTER_NAME).first()).toBeVisible();

    await page.getByText(CLUSTER_NAME).first().click();

    await expect(page).toHaveURL(`/dashboard/clusters/${CLUSTER_ID}?workload=overview`);
    await expect(page.getByText("Overview Runtime Status")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Resume overview runtime section" }),
    ).toBeVisible();
    await expect(page.getByText(/^Cached · .*Refreshing(?:\.\.\.)?$/i).first()).toBeVisible();
  });
});
