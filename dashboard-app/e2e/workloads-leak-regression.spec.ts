import { expect, test } from "@playwright/test";

const CLUSTER_ID = "dev";
const WORKLOADS = [
  "deployments",
  "configmaps",
  "jobs",
  "cronjobs",
  "daemonsets",
  "statefulsets",
] as const;

function snapshotFor(workload: string) {
  if (workload === "deployments" || workload === "daemonsets" || workload === "statefulsets") {
    return JSON.stringify({
      schemaVersion: 1,
      cachedAt: Date.now(),
      data: [
        {
          metadata: {
            uid: `${workload}-leak-1`,
            name: `cached-${workload}-leak`,
            namespace: "default",
            creationTimestamp: new Date().toISOString(),
            resourceVersion: "500",
          },
          spec: {
            replicas: 1,
            selector: { matchLabels: { app: `cached-${workload}-leak` } },
            template: {
              metadata: { labels: { app: `cached-${workload}-leak` } },
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
          uid: `${workload}-leak-1`,
          name: `cached-${workload}-leak`,
          namespace: "default",
          creationTimestamp: new Date().toISOString(),
          resourceVersion: "500",
        },
      },
    ],
  });
}

test.describe("workloads leak regression", () => {
  test("survives long rapid switching without runtime errors", async ({ browser }) => {
    const entries = WORKLOADS.flatMap((workload) => {
      const value = snapshotFor(workload);
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
        for (const item of items as Array<{ key: string; value: string }>) {
          window.localStorage.setItem(item.key, item.value);
        }
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
                // keep background refresh pending during stress switching
              }),
          };
        }
      },
      [entries],
    );

    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    for (let i = 0; i < 30; i += 1) {
      const workload = WORKLOADS[i % WORKLOADS.length]!;
      await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=${workload}`);
      await expect(page.getByText(/^(Cached|Stale cache) ·/i).first()).toBeVisible();
    }

    await expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });
});
