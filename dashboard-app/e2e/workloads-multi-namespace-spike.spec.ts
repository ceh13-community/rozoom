import { expect, test } from "@playwright/test";

const CLUSTER_ID = "dev";
const WORKLOAD = "configmaps";
const CACHE_KEYS = [
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::${WORKLOAD}::all::none`)}`,
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::${WORKLOAD}::all::name`)}`,
];

function buildConfigMaps(count: number) {
  return Array.from({ length: count }, (_, idx) => ({
    metadata: {
      uid: `cm-${idx}`,
      name: `cm-${idx}`,
      namespace: `ns-${idx % 25}`,
      creationTimestamp: new Date(Date.now() - idx * 500).toISOString(),
      resourceVersion: String(idx + 100),
    },
    data: {
      "app.yaml": `replicas: ${idx % 5}`,
    },
  }));
}

test.describe("workloads multi-namespace spike", () => {
  test("renders large configmaps snapshot with bounded table rows", async ({ browser }) => {
    const payload = buildConfigMaps(3000);
    const workloadSnapshot = JSON.stringify({
      schemaVersion: 1,
      cachedAt: Date.now(),
      data: payload,
    });

    const context = await browser.newContext();
    await context.addInitScript(
      ([keys, value]) => {
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
                // Keep refresh pending to verify cached rendering only.
              }),
          };
        }
        for (const key of keys) window.localStorage.setItem(key, value);
      },
      [CACHE_KEYS, workloadSnapshot],
    );

    const page = await context.newPage();
    await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=${WORKLOAD}`);
    await expect(page.getByText(/^(Cached|Stale cache) ·/i)).toBeVisible();
    await expect(page.locator("tbody tr").nth(1)).toBeVisible({ timeout: 15_000 });
    const renderedRows = await page.locator("tbody tr").count();
    expect(renderedRows).toBeGreaterThan(10);
    expect(renderedRows).toBeLessThan(650);
  });
});
