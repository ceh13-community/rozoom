import { expect, test } from "@playwright/test";

const CLUSTER_ID = "dev";

type SurfaceCase = {
  workload: string;
  rowName: string;
  payload: Record<string, unknown>[];
};

const cases: SurfaceCase[] = [
  {
    workload: "endpointslices",
    rowName: "api-slice",
    payload: [
      {
        metadata: {
          uid: "endpointslice-1",
          name: "api-slice",
          namespace: "default",
          creationTimestamp: new Date().toISOString(),
          labels: {
            "kubernetes.io/service-name": "api",
          },
        },
        addressType: "IPv4",
        endpoints: [{ addresses: ["10.0.0.15"], conditions: { ready: true } }],
        ports: [{ port: 443, protocol: "TCP" }],
      },
    ],
  },
  {
    workload: "volumeattributesclasses",
    rowName: "fast-attrs",
    payload: [
      {
        metadata: {
          uid: "vac-1",
          name: "fast-attrs",
          creationTimestamp: new Date().toISOString(),
        },
        driverName: "csi.example.com",
      },
    ],
  },
  {
    workload: "csistoragecapacities",
    rowName: "standard-capacity",
    payload: [
      {
        metadata: {
          uid: "csisc-1",
          name: "standard-capacity",
          namespace: "default",
          creationTimestamp: new Date().toISOString(),
        },
        storageClassName: "standard",
        capacity: "100Gi",
      },
    ],
  },
];

for (const scenario of cases) {
  test(`extended surface ${scenario.workload} renders cached rows`, async ({ browser }) => {
    const cacheKeys = [
      `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::${scenario.workload}::all::none`)}`,
      `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::${scenario.workload}::all::name`)}`,
    ];

    const workloadSnapshot = JSON.stringify({
      schemaVersion: 1,
      cachedAt: Date.now(),
      data: scenario.payload,
    });

    const context = await browser.newContext();
    await context.addInitScript(
      ([keys, value]) => {
        (
          window as typeof window & {
            __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<never> };
          }
        ).__TAURI_INTERNALS__ = {
          invoke: async (_cmd: string) =>
            await new Promise<never>(() => {
              // Keep background refresh pending so the cached route state is asserted directly.
            }),
        };

        for (const key of keys) {
          window.localStorage.setItem(key, value);
        }
      },
      [cacheKeys, workloadSnapshot],
    );

    const page = await context.newPage();
    await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=${scenario.workload}`);

    await expect(page.getByText(/^(Cached|Stale cache) ·/i).first()).toBeVisible();
    await expect(page.getByText(scenario.rowName, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });
}
