import { expect, test } from "@playwright/test";

const CLUSTER_ID = "dev";
const WORKLOAD = "customresourcedefinitions";
const CACHE_KEYS = [
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::${WORKLOAD}::all::none`)}`,
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::${WORKLOAD}::all::name`)}`,
];

const crdPayload = [
  {
    metadata: {
      uid: "crd-widgets-1",
      name: "widgets.example.com",
      creationTimestamp: new Date().toISOString(),
    },
    spec: {
      group: "example.com",
      names: {
        kind: "Widget",
        plural: "widgets",
      },
      scope: "Namespaced",
      versions: [{ name: "v1", served: true, storage: true }],
    },
  },
];

test.describe("custom resources browser", () => {
  test("loads custom resource instances from the dedicated CRD page", async ({ browser }) => {
    const workloadSnapshot = JSON.stringify({
      schemaVersion: 1,
      cachedAt: Date.now(),
      data: crdPayload,
    });

    const context = await browser.newContext();
    await context.addInitScript(
      ([keys, value]) => {
        const pending = () =>
          new Promise<never>(() => {
            // Keep background refresh suspended during cached-first assertions.
          });

        const invoke = async (cmd: string, payload?: { resource?: string }) => {
          if (cmd === "rozoom:namespaced-snapshot" && payload?.resource === "widgets.example.com") {
            return {
              items: [
                {
                  apiVersion: "example.com/v1",
                  kind: "Widget",
                  metadata: {
                    uid: "widget-1",
                    name: "example-widget",
                    namespace: "default",
                    creationTimestamp: new Date().toISOString(),
                  },
                },
              ],
            };
          }

          if (cmd.startsWith("plugin:cache|")) {
            if (cmd.endsWith("|get")) return null;
            return true;
          }

          return pending();
        };

        (
          window as typeof window & {
            __TAURI_INTERNALS__?: { invoke: (cmd: string, payload?: unknown) => Promise<unknown> };
          }
        ).__TAURI_INTERNALS__ = { invoke };

        for (const key of keys) {
          window.localStorage.setItem(key, value);
        }
      },
      [CACHE_KEYS, workloadSnapshot],
    );

    const page = await context.newPage();
    await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=${WORKLOAD}`);

    await expect(page.getByText(/widgets\.example\.com/i)).toBeVisible();
    await page.getByLabel("Open actions for widgets.example.com").click();
    await page.getByRole("menuitem", { name: "Browse instances", exact: true }).click();
    await expect(page.getByText("Instances for widgets.example.com")).toBeVisible();
    await expect(page.getByText("example-widget")).toBeVisible();
  });
});
