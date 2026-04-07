import { expect, test } from "@playwright/test";

const CLUSTER_ID = "dev";

const NODE_CACHE_KEYS = [
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::nodesstatus::all::none`)}`,
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::nodesstatus::all::name`)}`,
];

const RC_CACHE_KEYS = [
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::replicationcontrollers::all::none`)}`,
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::replicationcontrollers::all::name`)}`,
];

const nodesPayload = [
  {
    metadata: {
      uid: "node-cached-1",
      name: "worker-a",
      creationTimestamp: new Date().toISOString(),
      labels: {
        "node-role.kubernetes.io/worker": "",
        "kubernetes.io/os": "linux",
      },
    },
    status: {
      nodeInfo: {
        kubeletVersion: "v1.32.1",
      },
      conditions: [
        {
          type: "Ready",
          status: "True",
        },
      ],
      allocatable: {
        cpu: "4",
        memory: "8Gi",
      },
      capacity: {
        cpu: "4",
        memory: "8Gi",
      },
    },
    spec: {
      taints: [],
      unschedulable: false,
    },
  },
];

const replicationControllersPayload = [
  {
    metadata: {
      uid: "rc-cached-1",
      name: "cached-rc",
      namespace: "default",
      creationTimestamp: new Date().toISOString(),
    },
    spec: {
      replicas: 2,
      selector: {
        app: "cached-rc",
      },
    },
    status: {
      readyReplicas: 1,
    },
  },
];

const nodesSnapshot = JSON.stringify({
  schemaVersion: 1,
  cachedAt: Date.now(),
  data: nodesPayload,
});

const replicationControllersSnapshot = JSON.stringify({
  schemaVersion: 1,
  cachedAt: Date.now(),
  data: replicationControllersPayload,
});

test.describe("workload page parity", () => {
  test("nodes status keeps pane shell visible for edit yaml", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(
      ([cacheKeys, cacheValue]) => {
        const pending = () =>
          new Promise<never>(() => {
            // Keep background refresh pending so cached-first UI stays visible.
          });

        const invoke = async (cmd: string, payload?: { args?: string[] }) => {
          const args = payload?.args ?? [];
          if (cmd === "rozoom:kubectl-proxy" && args[0] === "get" && args[1] === "node") {
            return {
              output: "apiVersion: v1\nkind: Node\nmetadata:\n  name: worker-a\n",
              errors: "",
              code: 0,
            };
          }
          return pending();
        };

        (
          window as typeof window & {
            __TAURI_INTERNALS__?: { invoke: (cmd: string, payload?: unknown) => Promise<unknown> };
          }
        ).__TAURI_INTERNALS__ = { invoke };

        for (const key of cacheKeys) {
          window.localStorage.setItem(key, cacheValue);
        }
      },
      [NODE_CACHE_KEYS, nodesSnapshot],
    );

    const page = await context.newPage();
    await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=nodesstatus`);

    await expect(page.getByText(/^(Cached|Stale cache) ·/i).first()).toBeVisible();
    await expect(page.getByText("worker-a")).toBeVisible();
    await page.getByLabel("Open actions for worker-a").first().click();
    await page.getByRole("menuitem", { name: "Edit YAML", exact: true }).click();
    await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Fullscreen" })).toBeVisible();
    await expect(page.getByText("Resource YAML: worker-a")).toBeVisible();
  });

  test("replication controllers keeps workload-style top section rhythm", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(
      ([cacheKeys, cacheValue]) => {
        (
          window as typeof window & {
            __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<never> };
          }
        ).__TAURI_INTERNALS__ = {
          invoke: async (_cmd: string) =>
            await new Promise<never>(() => {
              // Keep background refresh pending so cached-first UI stays visible.
            }),
        };

        for (const key of cacheKeys) {
          window.localStorage.setItem(key, cacheValue);
        }
      },
      [RC_CACHE_KEYS, replicationControllersSnapshot],
    );

    const page = await context.newPage();
    await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=replicationcontrollers`);

    // Runtime status shows in compact mode (default) - verify badge is visible
    await expect(page.getByText("Cached").first()).toBeVisible();
    await expect(page.getByText("A list of replication controllers.")).toBeVisible();
    await expect(page.getByRole("cell", { name: "cached-rc", exact: true })).toBeVisible();
  });
});
