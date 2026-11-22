import { expect, test, type Page } from "@playwright/test";

// Reported on 0.26.3 and again on 0.26.5 RC1: "the screen and CPU/Memory jump on refresh".
// A refresh that brings the same data must not move the list: scroll position, the height
// of the list, the row order and the column positions stay as they were. CPU and Memory
// values that change length ("1m" to "1234m", "9Mi" to "1024Mi") must not move the columns.

const CLUSTER_ID = "dev";
const POD_COUNT = 120;
const NAMESPACES = ["apps", "default", "kube-system", "monitoring"];
const WORKLOAD_CACHE_KEYS = [
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::pods::all::none`)}`,
  `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::pods::all::name`)}`,
];
const PODS_SCOPE_KEY = `${CLUSTER_ID}::all`;

type Harness = { snapshots: number; tops: number; metricsCycle: number };
type Layout = {
  listScrollTop: number;
  listHeight: number;
  mainScrollTop: number;
  rowOrder: string[];
  headerCells: string[];
  rowCells: string[];
  cpu: string;
};

function buildPods() {
  return Array.from({ length: POD_COUNT }, (_, idx) => ({
    metadata: {
      uid: `pod-${idx}`,
      name: `pod-${String(idx).padStart(3, "0")}`,
      namespace: NAMESPACES[idx % NAMESPACES.length],
      ownerReferences: [{ kind: "ReplicaSet" }],
    },
    status: {
      startTime: new Date(Date.UTC(2026, 10, 1) - idx * 60_000).toISOString(),
      qosClass: "Burstable",
      containerStatuses: [{ ready: true, restartCount: idx % 3 }],
      phase: "Running",
    },
    spec: { nodeName: `node-${idx % 3}` },
  }));
}

async function openPods(page: Page, pods: ReturnType<typeof buildPods>) {
  const snapshot = JSON.stringify({ schemaVersion: 1, cachedAt: Date.now(), data: pods });
  const podsSnapshot = {
    key: `dashboard.pods.snapshot.v1:${encodeURIComponent(PODS_SCOPE_KEY)}`,
    value: JSON.stringify({
      schemaVersion: 1,
      scopeKey: PODS_SCOPE_KEY,
      cachedAt: Date.now(),
      pods,
    }),
  };
  // Shortest watcher interval the page accepts, with the CPU and Memory columns on.
  const settings = {
    key: `dashboard.pods.rewrite.settings.v1:${CLUSTER_ID}`,
    value: JSON.stringify({ enabled: true, refreshSeconds: 5, enrichedTableEnabled: true }),
  };
  await page.context().addInitScript(
    ([workloadKeys, workloadValue, snapshotEntry, settingsEntry, basePods]) => {
      const harness: Harness = { snapshots: 0, tops: 0, metricsCycle: 0 };
      (window as typeof window & { __podsHarness?: Harness }).__podsHarness = harness;
      // Same values each cycle unless the test moves metricsCycle: then they grow in length.
      const CPU = ["1m", "12m", "1234m"];
      const MEMORY = ["9Mi", "128Mi", "1024Mi"];
      (window as typeof window & { __TAURI__?: object }).__TAURI__ = {};
      (
        window as typeof window & {
          __TAURI_INTERNALS__?: { invoke: (cmd: string, payload?: unknown) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, payload?: unknown) => {
          if (cmd === "rozoom:namespaced-snapshot") {
            harness.snapshots += 1;
            return { items: basePods };
          }
          const args = (payload as { args?: string[] } | undefined)?.args ?? [];
          if (cmd === "rozoom:kubectl-proxy" && args[0] === "top") {
            harness.tops += 1;
            const cpu = CPU[harness.metricsCycle % CPU.length];
            const memory = MEMORY[harness.metricsCycle % MEMORY.length];
            const output = basePods
              .map((pod) => `${pod.metadata.namespace} ${pod.metadata.name} ${cpu} ${memory}`)
              .join("\n");
            return { output, errors: "", code: 0 };
          }
          return await new Promise<never>(() => {
            // Everything else stays pending: only pods and their metrics refresh.
          });
        },
      };
      for (const key of workloadKeys) window.localStorage.setItem(key, workloadValue);
      window.localStorage.setItem(snapshotEntry.key, snapshotEntry.value);
      window.localStorage.setItem(settingsEntry.key, settingsEntry.value);
    },
    [WORKLOAD_CACHE_KEYS, snapshot, podsSnapshot, settings, pods] as const,
  );
  await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=pods`);
  await expect(page.getByText(`Rows: ${POD_COUNT}`, { exact: true })).toBeVisible();
}

async function harness(page: Page) {
  return (await page.evaluate(
    () => (window as typeof window & { __podsHarness?: Harness }).__podsHarness,
  )) as Harness;
}

async function waitFor(page: Page, field: "snapshots" | "tops", atLeast: number) {
  await page.waitForFunction(
    ([key, min]) =>
      ((window as typeof window & { __podsHarness?: Harness }).__podsHarness?.[key] ?? 0) >= min,
    [field, atLeast] as const,
    { timeout: 30_000 },
  );
  // Let the page apply what the refresh returned.
  await page.waitForTimeout(800);
}

async function layout(page: Page): Promise<Layout> {
  return await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>(".pods-k9s-table");
    const main = [...document.querySelectorAll<HTMLElement>("main")]
      .filter((m) => m.offsetParent)
      .pop();
    const rows = [...document.querySelectorAll<HTMLElement>(".pods-k9s-table__row")];
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return `${Math.round(rect.left)}+${Math.round(rect.width)}`;
    };
    const header = document.querySelector(".pods-k9s-table__header");
    const firstRow = rows[0];
    const headerTexts = header ? [...header.children].map((cell) => cell.textContent ?? "") : [];
    const cpuIndex = headerTexts.findIndex((text) => /cpu/i.test(text));
    return {
      listScrollTop: Math.round(list?.scrollTop ?? -1),
      listHeight: Math.round(list?.getBoundingClientRect().height ?? -1),
      mainScrollTop: Math.round(main?.scrollTop ?? -1),
      rowOrder: rows.map((row) => row.textContent?.match(/pod-\d{3}/)?.[0] ?? "?"),
      headerCells: header ? [...header.children].map(box) : [],
      rowCells: firstRow ? [...firstRow.children].map(box) : [],
      cpu: cpuIndex >= 0 && firstRow ? (firstRow.children[cpuIndex]?.textContent ?? "").trim() : "",
    };
  });
}

test.describe("pods list refresh stability", () => {
  test.setTimeout(90_000);

  test("a refresh with the same data moves nothing, over 2+ cycles", async ({ page }) => {
    await openPods(page, buildPods());
    await page.evaluate(() => {
      const list = document.querySelector<HTMLElement>(".pods-k9s-table");
      if (list) list.scrollTop = 600;
    });
    await waitFor(page, "tops", 1);
    const start = await harness(page);
    const before = await layout(page);
    expect(before.listScrollTop).toBeGreaterThan(0);
    expect(before.rowOrder.length).toBeGreaterThan(0);

    for (let cycle = 1; cycle <= 2; cycle += 1) {
      await waitFor(page, "snapshots", start.snapshots + cycle);
      await waitFor(page, "tops", start.tops + cycle);
      expect(await layout(page), `refresh cycle ${cycle}`).toEqual(before);
    }
  });

  test("CPU and Memory values that grow in length keep the columns in place", async ({ page }) => {
    await openPods(page, buildPods());
    await waitFor(page, "tops", 1);
    const before = await layout(page);
    expect(before.cpu).toBe("1m");

    for (const cycle of [1, 2]) {
      const { tops } = await harness(page);
      await page.evaluate((next) => {
        (window as typeof window & { __podsHarness?: Harness }).__podsHarness!.metricsCycle = next;
      }, cycle);
      await waitFor(page, "tops", tops + 1);
      const after = await layout(page);
      expect(after.cpu).toBe(cycle === 1 ? "12m" : "1234m");
      expect(after.headerCells, `header after cycle ${cycle}`).toEqual(before.headerCells);
      expect(after.rowCells, `first row after cycle ${cycle}`).toEqual(before.rowCells);
      expect(after.listHeight).toBe(before.listHeight);
    }
  });
});
