import { expect, test } from "@playwright/test";

const CLUSTER_ID = "dev";
const WORKLOADS = ["pods", "deployments", "configmaps"] as const;

function cacheKeys(workload: string) {
  return [
    `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::${workload}::all::none`)}`,
    `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::${workload}::all::name`)}`,
  ];
}

const snapshots: Record<string, string> = {
  pods: JSON.stringify({
    schemaVersion: 1,
    cachedAt: Date.now(),
    data: [
      {
        metadata: {
          uid: "pod-1",
          name: "soak-pod",
          namespace: "default",
          ownerReferences: [{ kind: "ReplicaSet" }],
        },
        status: {
          phase: "Running",
          containerStatuses: [{ ready: true, restartCount: 0 }],
          qosClass: "Burstable",
        },
        spec: { nodeName: "node-a" },
      },
    ],
  }),
  deployments: JSON.stringify({
    schemaVersion: 1,
    cachedAt: Date.now(),
    data: [
      {
        metadata: {
          uid: "dep-1",
          name: "soak-deployment",
          namespace: "default",
          creationTimestamp: new Date().toISOString(),
        },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: "soak" } },
          template: {
            metadata: { labels: { app: "soak" } },
            spec: { containers: [{ name: "main", image: "nginx" }] },
          },
        },
        status: { readyReplicas: 1, replicas: 1, updatedReplicas: 1, availableReplicas: 1 },
      },
    ],
  }),
  configmaps: JSON.stringify({
    schemaVersion: 1,
    cachedAt: Date.now(),
    data: [
      {
        metadata: {
          uid: "cm-1",
          name: "soak-config",
          namespace: "default",
          creationTimestamp: new Date().toISOString(),
          resourceVersion: "100",
        },
        data: { "app.yaml": "replicas: 1" },
      },
    ],
  }),
};

test.describe("workloads long session soak", () => {
  test("keeps cached-first rendering stable over repeated workload switches", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await context.addInitScript(
      ([entries]) => {
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
                // keep refresh pending; verify cached-first path stability
              }),
          };
        }
        for (const entry of entries as Array<{ key: string; value: string }>) {
          window.localStorage.setItem(entry.key, entry.value);
        }
      },
      [
        WORKLOADS.flatMap((workload) =>
          cacheKeys(workload).map((key) => ({ key, value: snapshots[workload] ?? "[]" })),
        ),
      ],
    );

    const page = await context.newPage();
    for (let i = 0; i < 18; i += 1) {
      const workload = WORKLOADS[i % WORKLOADS.length]!;
      await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=${workload}`);
      await expect(
        page
          .getByText(
            /(Cached|Stale cache) · .*(Refreshing|Ready|Refresh failed, showing last snapshot)/i,
          )
          .first(),
      ).toBeVisible();
    }
  });
});
