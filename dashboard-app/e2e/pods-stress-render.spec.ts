import { expect, test } from "@playwright/test";

const CLUSTER_ID = "dev";

const WORKLOAD_CACHE_KEYS = [
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::pods::all::none`)}`,
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::pods::all::name`)}`,
];
const PODS_SCOPE_KEY = `${CLUSTER_ID}::all`;

const SMALL_NAMESPACES = [
  "apps",
  "cert-manager",
  "default",
  "ingress",
  "kube-system",
  "logging",
  "monitoring",
  "web",
];
const POD_COUNT = 5000;
// Pods of the last namespace sit at the end of the list, far past any early cap,
// so a page that drops pods before building its namespace list loses it.
const LATE_NAMESPACE = "zz-batch";
const LATE_NAMESPACE_FROM = 4500;

function buildPods(count: number) {
  return Array.from({ length: count }, (_, idx) => ({
    metadata: {
      uid: `pod-${idx}`,
      name: `pod-${idx}`,
      namespace:
        idx >= LATE_NAMESPACE_FROM
          ? LATE_NAMESPACE
          : SMALL_NAMESPACES[idx % SMALL_NAMESPACES.length],
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
    test.setTimeout(90_000);
    const pods = buildPods(POD_COUNT);
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

    // Every pod reaches the table: counter, summary and namespace filter cover all of them.
    await expect(page.getByText(`Rows: ${POD_COUNT}`, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: `NS (${SMALL_NAMESPACES.length + 1}/${SMALL_NAMESPACES.length + 1})`,
      }),
    ).toBeVisible();

    // The flat list pages and virtualizes, so only a bounded slice is in the DOM.
    const renderedRows = await page.locator(".pods-k9s-table__row").count();
    expect(renderedRows).toBeGreaterThan(0);
    expect(renderedRows).toBeLessThanOrEqual(100);

    // Grouped views render without pagination and stay capped, with a notice.
    await page.getByLabel("Group by namespace").click();
    await expect(page.getByText(`shows the first 400 of ${POD_COUNT} pods`)).toBeVisible();
    expect(await page.locator(".pods-k9s-table__row").count()).toBe(400);
  });

  test("measures cached render and watcher refresh of 5000 pods", async ({ browser }) => {
    test.setTimeout(90_000);
    const pods = buildPods(POD_COUNT);
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
    // Shortest watcher interval the page accepts, so the measured refreshes are watcher ticks.
    const watcherSettings = {
      key: `dashboard.pods.rewrite.settings.v1:${CLUSTER_ID}`,
      value: JSON.stringify({ enabled: true, refreshSeconds: 5, enrichedTableEnabled: false }),
    };

    type PodsHarness = { extraPods: number; servedAt: Record<number, number> };

    const context = await browser.newContext();
    await context.addInitScript(
      ([workloadKeys, workloadValue, snapshotEntry, settings, basePods]) => {
        const harness: PodsHarness = { extraPods: 0, servedAt: {} };
        (window as typeof window & { __podsHarness?: PodsHarness }).__podsHarness = harness;
        // The page skips refreshes in a plain browser preview that already has cached pods.
        // A __TAURI__ marker routes refreshes through the mocked invoke, as on desktop.
        (window as typeof window & { __TAURI__?: object }).__TAURI__ = {};
        (
          window as typeof window & {
            __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<unknown> };
          }
        ).__TAURI_INTERNALS__ = {
          invoke: async (cmd: string) => {
            if (cmd !== "rozoom:namespaced-snapshot") {
              return await new Promise<never>(() => {
                // Only the pods snapshot answers; everything else stays pending.
              });
            }
            // The test raises extraPods; the next watcher tick serves that many more pods.
            const extra = Array.from({ length: harness.extraPods }, (_, idx) => ({
              ...basePods[idx],
              metadata: { ...basePods[idx].metadata, uid: `extra-${idx}`, name: `extra-${idx}` },
            }));
            const items = [...basePods, ...extra];
            harness.servedAt[items.length] ??= performance.now();
            return { items };
          },
        };
        for (const key of workloadKeys) {
          window.localStorage.setItem(key, workloadValue);
        }
        window.localStorage.setItem(snapshotEntry.storageKey, snapshotEntry.value);
        window.localStorage.setItem(settings.key, settings.value);
      },
      [
        WORKLOAD_CACHE_KEYS,
        workloadPodsSnapshot,
        podsSnapshotEntry,
        watcherSettings,
        pods,
      ] as const,
    );

    const page = await context.newPage();
    await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=pods`);

    // Milliseconds until the Rows counter shows `rows`: since navigation start, or since the
    // watcher tick that served that many pods.
    const waitForRows = async (rows: number, sinceServed: boolean) => {
      const handle = await page.waitForFunction(
        ([expected, fromServed]) => {
          if (!document.body.innerText.includes(`Rows: ${expected}`)) return false;
          const harness = (window as typeof window & { __podsHarness?: PodsHarness }).__podsHarness;
          const start = fromServed ? (harness?.servedAt[expected] ?? 0) : 0;
          return Math.round(performance.now() - start);
        },
        [rows, sinceServed] as const,
        { polling: "raf", timeout: 30_000 },
      );
      return (await handle.jsonValue()) as number;
    };

    const cachedRenderMs = await waitForRows(POD_COUNT, false);
    const watcherRefreshMs: number[] = [];
    for (const extraPods of [1, 2, 3]) {
      await page.evaluate((count) => {
        (window as typeof window & { __podsHarness?: PodsHarness }).__podsHarness!.extraPods =
          count;
      }, extraPods);
      watcherRefreshMs.push(await waitForRows(POD_COUNT + extraPods, true));
    }

    const timings = { pods: POD_COUNT, cachedRenderMs, watcherRefreshMs };
    console.log(`pods stress timings ${JSON.stringify(timings)}`);
    test.info().annotations.push({ type: "timings", description: JSON.stringify(timings) });

    // Loose ceilings: they catch an order-of-magnitude regression, not CI noise.
    expect(cachedRenderMs).toBeLessThan(15_000);
    for (const refreshMs of watcherRefreshMs) {
      expect(refreshMs).toBeLessThan(5_000);
    }
  });
});
