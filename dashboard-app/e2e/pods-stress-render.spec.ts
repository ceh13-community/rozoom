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
});
