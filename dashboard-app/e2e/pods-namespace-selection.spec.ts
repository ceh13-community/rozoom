import { expect, test, type Browser, type Page } from "@playwright/test";

const CLUSTER_ID = "dev";
const NAMESPACES = ["alpha", "beta", "gamma"];

type PodsHarness = {
  // Pod names per namespace, as the cluster would return them right now.
  pods: Record<string, string[]>;
  requests: string[];
  // Round trip of one pods request.
  delayMs: number;
};

function requestCount(page: Page) {
  return page.evaluate(
    () =>
      (window as typeof window & { __podsHarness?: PodsHarness }).__podsHarness!.requests.length,
  );
}

// A load started from an effect must not re-run that effect when it finishes.
// If it does, loads run back to back with no watcher interval between them.
async function expectNoReloadLoop(page: Page) {
  const before = await requestCount(page);
  await page.waitForTimeout(1_500);
  expect(await requestCount(page)).toBe(before);
}

function harnessPods(page: Page, pods: Record<string, string[]>) {
  return page.evaluate((next) => {
    (window as typeof window & { __podsHarness?: PodsHarness }).__podsHarness!.pods = next;
  }, pods);
}

async function chooseNamespaces(page: Page, wanted: string[] | "all" | "none") {
  await page.locator(".namespace-select-trigger").click();
  const all = page.getByRole("checkbox", { name: "All Namespaces" });
  await all.setChecked(false);
  if (wanted === "all") {
    await all.setChecked(true);
  } else if (wanted !== "none") {
    for (const namespace of wanted) {
      await page.getByRole("checkbox", { name: namespace, exact: true }).setChecked(true);
    }
  }
  // The selection applies when the dropdown closes.
  await page.locator(".namespace-select-trigger").click();
}

async function expectTable(page: Page, names: string[]) {
  const rows = page.locator(".pods-k9s-table__row");
  await expect(page.getByText(`Rows: ${names.length}`, { exact: true })).toBeVisible();
  await expect(rows).toHaveCount(names.length);
  for (const name of names) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
}

async function openPodsPage(browser: Browser) {
  const context = await browser.newContext();
  await context.addInitScript(
    ([clusterId, namespaces]) => {
      const harness: PodsHarness = {
        pods: { alpha: ["alpha-1", "alpha-2"], beta: ["beta-1"], gamma: ["gamma-1"] },
        requests: [],
        delayMs: 50,
      };
      (window as typeof window & { __podsHarness?: PodsHarness }).__podsHarness = harness;

      const toPod = (namespace: string, name: string) => ({
        metadata: { uid: `${namespace}-${name}`, name, namespace },
        status: {
          phase: "Running",
          startTime: new Date().toISOString(),
          containerStatuses: [{ ready: true, restartCount: 0 }],
        },
        spec: { nodeName: "node-a", containers: [{ name: "main" }] },
      });
      const pending = () => new Promise<never>(() => {});

      // The page skips refreshes in a plain browser preview that already has
      // cached pods. A __TAURI__ marker routes them through the mocked invoke.
      (window as typeof window & { __TAURI__?: object }).__TAURI__ = {};
      (
        window as typeof window & {
          __TAURI_INTERNALS__?: { invoke: (cmd: string, payload?: unknown) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, payload?: unknown) => {
          const body = (payload ?? {}) as { args?: string[]; selectedNamespace?: string };
          if (cmd === "rozoom:namespaced-snapshot") {
            const selection = body.selectedNamespace ?? "all";
            harness.requests.push(selection);
            // The answer holds the cluster state at request time, and arrives
            // after a round trip, like a real cluster.
            const wanted = selection === "all" ? Object.keys(harness.pods) : selection.split(",");
            const items = wanted.flatMap((namespace) =>
              (harness.pods[namespace] ?? []).map((name) => toPod(namespace, name)),
            );
            await new Promise((resolve) => setTimeout(resolve, harness.delayMs));
            return { items };
          }
          if (cmd === "rozoom:kubectl-proxy" && body.args?.includes("namespaces")) {
            return {
              output: JSON.stringify({
                items: namespaces.map((name) => ({ metadata: { name } })),
              }),
              errors: "",
              code: 0,
            };
          }
          if (cmd.startsWith("plugin:cache|")) return cmd.endsWith("|get") ? null : true;
          if (cmd.startsWith("plugin:log|")) return true;
          return pending();
        },
      };
      // A long watcher interval: every reload in this test comes from the
      // namespace change, not from a watcher tick.
      window.localStorage.setItem(
        `dashboard.pods.rewrite.settings.v1:${clusterId}`,
        JSON.stringify({ enabled: true, refreshSeconds: 600, enrichedTableEnabled: false }),
      );
    },
    [CLUSTER_ID, NAMESPACES] as const,
  );

  const page = await context.newPage();
  await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=pods`);
  await expectTable(page, ["alpha-1", "alpha-2", "beta-1", "gamma-1"]);
  return page;
}

test("a namespace change reloads the pods list without leaving the page", async ({ browser }) => {
  const page = await openPodsPage(browser);

  // Each step changes what the cluster holds before the selection changes, so
  // only a fresh load shows the right pods.
  await harnessPods(page, {
    alpha: ["alpha-1", "alpha-2", "alpha-3"],
    beta: ["beta-1"],
    gamma: ["gamma-1"],
  });
  await chooseNamespaces(page, ["alpha"]);
  await expectTable(page, ["alpha-1", "alpha-2", "alpha-3"]);

  await harnessPods(page, {
    alpha: ["alpha-1", "alpha-2", "alpha-3"],
    beta: ["beta-1"],
    gamma: ["gamma-1", "gamma-2"],
  });
  await chooseNamespaces(page, "all");
  await expectTable(page, ["alpha-1", "alpha-2", "alpha-3", "beta-1", "gamma-1", "gamma-2"]);

  await chooseNamespaces(page, "none");
  await expect(page.getByText("Rows: 0", { exact: true })).toBeVisible();
  await expect(page.locator(".pods-k9s-table__row")).toHaveCount(0);

  await harnessPods(page, {
    alpha: ["alpha-1", "alpha-2", "alpha-3"],
    beta: ["beta-1", "beta-2"],
    gamma: ["gamma-1", "gamma-2"],
  });
  await chooseNamespaces(page, ["beta"]);
  await expectTable(page, ["beta-1", "beta-2"]);
  await expect(page.locator(".namespace-select-trigger")).toHaveText(/Namespace: beta/);
  await expectNoReloadLoop(page);
});

test("resuming the watcher loads once, not in a loop", async ({ browser }) => {
  const page = await openPodsPage(browser);
  await expectNoReloadLoop(page);

  await page.getByRole("button", { name: "Toggle runtime info" }).click();
  await page.getByRole("button", { name: "Pause pod runtime section" }).click();
  await expect(page.getByRole("button", { name: "Resume pod runtime section" })).toBeVisible();
  // Pausing loads once too. Let it finish, so the resume load is not joined to it.
  await expectNoReloadLoop(page);
  const beforeResume = await requestCount(page);
  await page.getByRole("button", { name: "Resume pod runtime section" }).click();
  await expect.poll(() => requestCount(page)).toBe(beforeResume + 1);
  await expectNoReloadLoop(page);
});

test("a namespace change during a running load shows the new selection", async ({ browser }) => {
  const page = await openPodsPage(browser);
  await expectNoReloadLoop(page);

  await page.evaluate(() => {
    (window as typeof window & { __podsHarness?: PodsHarness }).__podsHarness!.delayMs = 1_500;
  });
  await page.getByRole("button", { name: "Toggle runtime info" }).click();
  // Pausing loads all namespaces once; that answer takes a while.
  await page.getByRole("button", { name: "Pause pod runtime section" }).click();
  await harnessPods(page, {
    alpha: ["alpha-1", "alpha-2", "alpha-3"],
    beta: ["beta-1"],
    gamma: ["gamma-1"],
  });
  // The selection changes before that load answers. Its answer still holds
  // the old cluster state and must not replace the new selection's pods.
  await chooseNamespaces(page, ["alpha"]);

  await expectTable(page, ["alpha-1", "alpha-2", "alpha-3"]);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __podsHarness?: PodsHarness }).__podsHarness!.requests,
      ),
    )
    .toEqual(["all", "all", "alpha"]);
});

test("a namespace change in a browser without the desktop shell answers once from cache", async ({
  browser,
}) => {
  const toEntry = (scope: string, names: string[]) => {
    const scopeKey = `${CLUSTER_ID}::${scope}`;
    const pods = names.map((name) => ({
      metadata: { uid: `${scope}-${name}`, name, namespace: name.split("-")[0] },
      status: {
        phase: "Running",
        startTime: new Date().toISOString(),
        containerStatuses: [{ ready: true, restartCount: 0 }],
      },
      spec: { nodeName: "node-a", containers: [{ name: "main" }] },
    }));
    return {
      key: `dashboard.pods.snapshot.v1:${encodeURIComponent(scopeKey)}`,
      value: JSON.stringify({ schemaVersion: 1, scopeKey, cachedAt: Date.now(), pods }),
    };
  };
  const cached = [toEntry("all", ["alpha-1", "beta-1", "gamma-1"]), toEntry("alpha", ["alpha-1"])];

  const context = await browser.newContext();
  await context.addInitScript(
    ([entries, namespaces]) => {
      const harness = { podsRequests: 0 };
      (window as typeof window & { __previewHarness?: typeof harness }).__previewHarness = harness;
      // No __TAURI__ marker: the page runs as a plain browser preview, where
      // the pods list answers from its cache and does not call the cluster.
      (
        window as typeof window & {
          __TAURI_INTERNALS__?: { invoke: (cmd: string, payload?: unknown) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, payload?: unknown) => {
          const body = (payload ?? {}) as { args?: string[] };
          if (cmd === "rozoom:namespaced-snapshot") {
            harness.podsRequests += 1;
            return { items: [] };
          }
          if (cmd === "rozoom:kubectl-proxy" && body.args?.includes("namespaces")) {
            return {
              output: JSON.stringify({ items: namespaces.map((name) => ({ metadata: { name } })) }),
              errors: "",
              code: 0,
            };
          }
          if (cmd.startsWith("plugin:cache|")) return cmd.endsWith("|get") ? null : true;
          if (cmd.startsWith("plugin:log|")) return true;
          return await new Promise<never>(() => {});
        },
      };
      for (const entry of entries) window.localStorage.setItem(entry.key, entry.value);
    },
    [cached, NAMESPACES] as const,
  );

  const page = await context.newPage();
  await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=pods`);
  await expectTable(page, ["alpha-1", "beta-1", "gamma-1"]);

  await chooseNamespaces(page, ["alpha"]);
  await expectTable(page, ["alpha-1"]);

  // A hung tab never runs the next frame; a live one does at once.
  const frame = await Promise.race([
    page.evaluate(
      () => new Promise<string>((resolve) => requestAnimationFrame(() => resolve("frame"))),
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 3_000)),
  ]);
  expect(frame).toBe("frame");
  const podsRequests = await page.evaluate(
    () =>
      (window as typeof window & { __previewHarness?: { podsRequests: number } }).__previewHarness!
        .podsRequests,
  );
  expect(podsRequests).toBe(0);
});
