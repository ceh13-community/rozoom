import { expect, test, type Browser, type Page } from "@playwright/test";

// A stopped cluster must look stopped: a banner with the reason and Retry, never
// a skeleton, an empty list, "Watcher: Active" or a green badge.

const CLUSTER_ID = "dev";
const CLUSTER_NAME = "minikube";
// kubectl's last line for a stopped minikube.
const NO_ROUTE =
  "Unable to connect to the server: dial tcp 192.168.49.2:8443: connect: no route to host";

type Harness = { online: boolean; versionRequests: number };

async function openCluster(
  browser: Browser,
  route: string,
  options: { seedCluster?: boolean; linterOff?: boolean } = {},
) {
  const context = await browser.newContext();
  await context.addInitScript(
    ([noRoute, clusterId, clusterName, seedCluster, linterOff]) => {
      const harness: Harness = { online: false, versionRequests: 0 };
      (window as typeof window & { __clusterHarness?: Harness }).__clusterHarness = harness;
      const pending = () => new Promise<never>(() => {});
      const pod = (name: string) => ({
        metadata: { uid: `uid-${name}`, name, namespace: "default" },
        status: {
          phase: "Running",
          startTime: new Date().toISOString(),
          containerStatuses: [{ ready: true, restartCount: 0 }],
        },
        spec: { nodeName: "node-a", containers: [{ name: "main" }] },
      });
      // The marker routes page refreshes through the mocked invoke.
      (window as typeof window & { __TAURI__?: object }).__TAURI__ = {};

      // The desktop store plugin, one file per path.
      const files: Record<string, Record<string, unknown>> = {};
      if (seedCluster) {
        files["clusters.json"] = {
          clusters: [
            {
              uuid: clusterId,
              name: clusterName,
              addedAt: new Date("2026-11-01T00:00:00.000Z").toISOString(),
              needsInitialRefreshHint: false,
            },
          ],
        };
      }
      if (linterOff) {
        files["dashboard-preferences.json"] = { clusterLinterStates: { [clusterId]: false } };
      }
      const handles = new Map<number, Record<string, unknown>>();
      let nextHandle = 1;
      const storeCommand = (cmd: string, payload: unknown) => {
        const args = (payload ?? {}) as {
          rid?: number;
          path?: string;
          key?: string;
          value?: unknown;
        };
        if (cmd === "plugin:store|load") {
          const path =
            String(args.path ?? "")
              .split("/")
              .pop() ?? "";
          files[path] ??= {};
          const handle = nextHandle++;
          handles.set(handle, files[path]);
          return handle;
        }
        const file = handles.get(args.rid ?? -1) ?? {};
        if (cmd === "plugin:store|get") {
          const value = file[args.key ?? ""];
          return [value ?? null, value !== undefined];
        }
        if (cmd === "plugin:store|set") {
          file[args.key ?? ""] = args.value;
          return null;
        }
        return null;
      };
      (
        window as typeof window & {
          __TAURI_INTERNALS__?: { invoke: (cmd: string, payload?: unknown) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, payload?: unknown) => {
          const body = (payload ?? {}) as { args?: string[] };
          if (cmd.startsWith("plugin:store|")) return storeCommand(cmd, payload);
          if (cmd.startsWith("plugin:cache|")) return cmd.endsWith("|get") ? null : true;
          if (cmd.startsWith("plugin:log|")) return true;
          if (cmd === "rozoom:kubectl-proxy") {
            const args = body.args ?? [];
            if (args.includes("/version")) harness.versionRequests += 1;
            if (!harness.online) return { output: "", errors: noRoute, code: 1 };
            if (args.includes("/version")) {
              return { output: JSON.stringify({ gitVersion: "v1.31.0" }), errors: "", code: 0 };
            }
            if (args.includes("namespaces")) {
              return {
                output: JSON.stringify({ items: [{ metadata: { name: "default" } }] }),
                errors: "",
                code: 0,
              };
            }
            return pending();
          }
          if (cmd === "rozoom:namespaced-snapshot") {
            if (!harness.online) throw new Error(noRoute);
            return { items: [pod("api-1"), pod("api-2")] };
          }
          return pending();
        },
      };
    },
    [
      NO_ROUTE,
      CLUSTER_ID,
      CLUSTER_NAME,
      Boolean(options.seedCluster),
      Boolean(options.linterOff),
    ] as const,
  );
  const page = await context.newPage();
  await page.goto(route);
  return page;
}

function setOnline(page: Page) {
  return page.evaluate(() => {
    (window as typeof window & { __clusterHarness?: Harness }).__clusterHarness!.online = true;
  });
}

for (const workload of ["overview", "deployments", "globaltriage"]) {
  test(`${workload}: the banner is the page body while the cluster does not answer`, async ({
    browser,
  }) => {
    const page = await openCluster(
      browser,
      `/dashboard/clusters/${CLUSTER_ID}?workload=${workload}`,
    );
    const banner = page.getByTestId("cluster-unreachable-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-mode", "disconnected");
    await expect(banner).toContainText("Cluster unreachable");
    await expect(banner).toContainText("Reason: No route to the cluster address.");
    // The raw kubectl line only under Details.
    await expect(banner).not.toContainText(NO_ROUTE);
    await banner.getByRole("button", { name: "Details" }).click();
    await expect(banner).toContainText(NO_ROUTE);

    await expect(page.locator(".cluster-page__skeleton")).toHaveCount(0);
    await expect(page.getByText(/^No .* found/)).toHaveCount(0);
    await expect(page.getByText("No problems found.")).toHaveCount(0);
    await expect(page.getByText(/^Updating/)).toHaveCount(0);
  });
}

test("pods: nothing claims a live watcher or an empty cluster, and Retry brings the list back", async ({
  browser,
}) => {
  const page = await openCluster(browser, `/dashboard/clusters/${CLUSTER_ID}?workload=pods`);
  const banner = page.getByTestId("cluster-unreachable-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("did not answer, so the list is not updated.");
  await expect(page.getByTestId("list-freshness")).toContainText("Paused");
  await expect(page.getByText("Watcher: Active")).toHaveCount(0);
  await expect(page.getByText("No pods found for the current filter.")).toHaveCount(0);
  await expect(page.getByText(/^Updating/)).toHaveCount(0);

  await setOnline(page);
  await banner.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("cluster-unreachable-banner")).toHaveCount(0);
  await expect(page.getByText("api-1", { exact: true })).toBeVisible();
  await expect(page.getByText("api-2", { exact: true })).toBeVisible();
});

test("the fleet card shows Unreachable next to PAUSED when the Linter is off", async ({
  browser,
}) => {
  const page = await openCluster(browser, "/dashboard", { seedCluster: true, linterOff: true });
  const card = page.getByTestId("cluster-card").first();
  await expect(card).toBeVisible();

  // The health watcher still runs with this cluster's Linter off; its failed
  // load is enough, nobody has to press anything.
  const badge = card.getByTestId("cluster-connectivity-badge");
  await expect(badge).toHaveAttribute("data-state", "unreachable");
  await expect(card).toContainText("PAUSED");
  await expect(card).toContainText("Cluster unreachable");
  await expect(card).toContainText("No route to the cluster address");
  await expect(card).not.toContainText(/Drift aligned/i);
  await expect(card).not.toContainText(/Turn on the linter/i);

  // The header refresh icon is Retry too.
  await expect(card.getByRole("button", { name: "Retry connection" })).toBeVisible();

  await setOnline(page);
  await card.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(badge).toHaveAttribute("data-state", "online");
  await expect(card).not.toContainText("Cluster unreachable");
});
