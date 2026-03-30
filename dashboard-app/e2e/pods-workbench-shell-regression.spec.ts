import { expect, test } from "@playwright/test";

const CLUSTER_ID = "dev";

const WORKLOAD_CACHE_KEYS = [
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::pods::all::none`)}`,
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::pods::all::name`)}`,
];

const PODS_SCOPE_KEY = `${CLUSTER_ID}::all`;
const POD_REF = "default/cached-pod";

const podsPayload = [
  {
    metadata: {
      uid: "pod-cached-1",
      name: "cached-pod",
      namespace: "default",
      ownerReferences: [{ kind: "ReplicaSet" }],
      creationTimestamp: new Date().toISOString(),
    },
    status: {
      startTime: new Date().toISOString(),
      qosClass: "Burstable",
      containerStatuses: [{ ready: true, restartCount: 0, name: "main" }],
      phase: "Running",
    },
    spec: {
      nodeName: "node-a",
      containers: [{ name: "main", image: "nginx:stable" }],
    },
  },
];

const workloadPodsSnapshot = JSON.stringify({
  schemaVersion: 1,
  cachedAt: Date.now(),
  data: podsPayload,
});

const podsSnapshotEntry = {
  storageKey: `dashboard.pods.snapshot.v1:${encodeURIComponent(PODS_SCOPE_KEY)}`,
  value: JSON.stringify({
    schemaVersion: 1,
    scopeKey: PODS_SCOPE_KEY,
    cachedAt: Date.now(),
    pods: podsPayload,
  }),
};

test.describe("pods workbench shell regression", () => {
  test("keeps pane shell visible for logs, investigate, and edit yaml", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(
      ([workloadKeys, workloadValue, snapshotEntry]) => {
        const pending = () =>
          new Promise<never>(() => {
            // Keep background refresh pending and validate cached-first workbench actions.
          });

        const invoke = async (cmd: string, payload?: { args?: string[] }) => {
          if (cmd === "rozoom:kubectl-proxy") {
            const args = payload?.args ?? [];
            if (args.includes("logs")) {
              return {
                output: 'time=2026-03-12T22:24:53.945Z level=INFO msg="cached log line"\n',
                errors: "",
                code: 0,
              };
            }
            if (args.includes("events")) {
              return {
                output: JSON.stringify({
                  items: [
                    {
                      type: "Warning",
                      reason: "BackOff",
                      message: "Back-off restarting failed container",
                      count: 1,
                      lastTimestamp: "2026-03-12T22:24:53Z",
                      source: { component: "kubelet" },
                    },
                  ],
                }),
                errors: "",
                code: 0,
              };
            }
            if (args.includes("yaml")) {
              return {
                output: "apiVersion: v1\nkind: Pod\nmetadata:\n  name: cached-pod\n",
                errors: "",
                code: 0,
              };
            }
            return {
              output: "",
              errors: "",
              code: 0,
            };
          }

          if (cmd === "rozoom:namespaced-snapshot") {
            return { items: [] };
          }

          if (cmd.startsWith("plugin:cache|")) {
            if (cmd.endsWith("|get")) return null;
            return true;
          }

          if (cmd === "plugin:path|resolve_directory") {
            return "/tmp";
          }

          if (cmd.startsWith("plugin:log|")) {
            return true;
          }

          return pending();
        };

        (
          window as typeof window & {
            __TAURI_INTERNALS__?: { invoke: (cmd: string, payload?: unknown) => Promise<unknown> };
          }
        ).__TAURI_INTERNALS__ = { invoke };

        for (const key of workloadKeys) {
          window.localStorage.setItem(key, workloadValue);
        }
        window.localStorage.setItem(snapshotEntry.storageKey, snapshotEntry.value);
      },
      [WORKLOAD_CACHE_KEYS, workloadPodsSnapshot, podsSnapshotEntry],
    );

    const page = await context.newPage();
    await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=pods`);

    await expect(page.getByText("cached-pod", { exact: true })).toBeVisible();
    await page.getByLabel("Open actions for cached-pod").click();
    await page.getByRole("menuitem", { name: "Logs", exact: true }).click();
    await expect(page.getByText("Pane 1")).toBeVisible();
    await expect(page.getByText(`Pod logs: ${POD_REF}`)).toBeVisible();

    await page.getByLabel("Open actions for cached-pod").click();
    await page.getByRole("menuitem", { name: "Investigate", exact: true }).click();
    await expect(page.getByText("Pane 1")).toBeVisible();
    await expect(page.getByText(`Pod events: ${POD_REF}`)).toBeVisible();

    await page.getByLabel("Open actions for cached-pod").click();
    await page.getByRole("menuitem", { name: "Edit YAML", exact: true }).click();
    await expect(page.getByText("Pane 1")).toBeVisible();
    await expect(page.getByText(`Resource YAML: ${POD_REF}`)).toBeVisible();
  });
});
