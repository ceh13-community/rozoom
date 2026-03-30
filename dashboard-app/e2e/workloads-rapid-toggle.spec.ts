import { expect, test } from "@playwright/test";

const CLUSTER_ID = "dev";
const WORKLOADS = ["deployments", "configmaps", "jobs", "cronjobs"] as const;

function buildSnapshot(workload: string) {
  if (workload === "deployments") {
    return JSON.stringify({
      schemaVersion: 1,
      cachedAt: Date.now(),
      data: [
        {
          metadata: {
            uid: "dep-fast-1",
            name: "rapid-deploy",
            namespace: "default",
            creationTimestamp: new Date().toISOString(),
          },
          spec: {
            replicas: 1,
            selector: { matchLabels: { app: "rapid-deploy" } },
            template: {
              metadata: { labels: { app: "rapid-deploy" } },
              spec: { containers: [{ name: "main", image: "nginx" }] },
            },
          },
          status: { readyReplicas: 1, replicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        },
      ],
    });
  }
  return JSON.stringify({
    schemaVersion: 1,
    cachedAt: Date.now(),
    data: [
      {
        metadata: {
          uid: `${workload}-fast-1`,
          name: `rapid-${workload}`,
          namespace: "default",
          creationTimestamp: new Date().toISOString(),
          resourceVersion: "100",
        },
      },
    ],
  });
}

test.describe("workloads rapid toggle", () => {
  test("survives fast route toggling without dropping cached rows", async ({ browser }) => {
    const entries = WORKLOADS.flatMap((workload) => {
      const value = buildSnapshot(workload);
      return [
        {
          key: `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::${workload}::all::none`)}`,
          value,
        },
        {
          key: `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::${workload}::all::name`)}`,
          value,
        },
      ];
    });

    const context = await browser.newContext();
    await context.addInitScript(
      ([items]) => {
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
                // keep refresh pending while rapidly switching tabs
              }),
          };
        }
        for (const item of items as Array<{ key: string; value: string }>) {
          window.localStorage.setItem(item.key, item.value);
        }
      },
      [entries],
    );

    const page = await context.newPage();
    for (let i = 0; i < 16; i += 1) {
      const workload = WORKLOADS[i % WORKLOADS.length]!;
      await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=${workload}`);
      await expect(page.getByText(/^(Cached|Stale cache) ·/i).first()).toBeVisible();
    }
    await expect(page.getByText(/rapid-/i)).toBeVisible();
  });
});
