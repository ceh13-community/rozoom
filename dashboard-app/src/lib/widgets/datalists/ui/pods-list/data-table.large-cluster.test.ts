import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import DataTable from "./data-table.svelte";
import { filterPodListRows, type PodListRow } from "./model/pod-list-row";

// jsdom needs seconds per hundred grouped rows, so the grouped cap is lowered
// here. The production value is pinned by the pods list row cap contract test.
vi.mock("./model/pod-list-row", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./model/pod-list-row")>()),
  GROUPED_VIEW_MAX_ROWS: 20,
}));

const SMALL_NAMESPACES = [
  "apps",
  "cert-manager",
  "dev",
  "ingress",
  "kube-system",
  "logging",
  "monitoring",
  "web",
];

// 492 pods in 9 namespaces. The last 92 pods by name all live in "zz-batch",
// the namespace a cap on the first 400 pods used to drop from the NS filter.
function buildLargeClusterRows(): PodListRow[] {
  return Array.from({ length: 492 }, (_, index) => ({
    uid: `pod-${index}`,
    name: `pod-${String(index).padStart(3, "0")}`,
    namespace: index < 400 ? SMALL_NAMESPACES[index % SMALL_NAMESPACES.length] : "zz-batch",
    status: "Running",
    readyContainers: 1,
    totalContainers: 1,
    restarts: 0,
    node: `node-${index % 3}`,
    age: "5m",
    ageSeconds: 300,
  }));
}

function getRowsCounterText(container: HTMLElement) {
  const counter = [...container.querySelectorAll("div")].find((element) =>
    /^Rows: \d+$/.test(element.textContent?.replace(/\s+/g, " ").trim() ?? ""),
  );
  return counter?.textContent?.replace(/\s+/g, " ").trim();
}

function getRenderedRowNamespaces(container: HTMLElement) {
  return new Set(
    [...container.querySelectorAll(".pods-k9s-table__row")].map((row) => {
      const cells = row.querySelectorAll(":scope > div");
      return cells[3]?.textContent?.trim();
    }),
  );
}

const baseProps = {
  query: "",
  onQueryChange: vi.fn(),
  enrichedTableEnabled: false,
  metricsByKey: new Map(),
  metricsCoverageCount: 0,
  metricsLoading: false,
  metricsError: null,
  metricsRecommendation: null,
  metricsSourcesHref: "/clusters/test?workload=metricssources",
  onToggleEnrichedTable: vi.fn(),
  isSelected: vi.fn(() => false),
  areAllSelected: false,
  isSomeSelected: false,
  onToggleSelect: vi.fn(),
  onToggleAll: vi.fn(),
  onSelectableIdsChange: vi.fn(),
  onOpenDetails: vi.fn(),
  onEvents: vi.fn(),
  onShell: vi.fn(),
  onAttach: vi.fn(),
  onLogs: vi.fn(),
  onEditYaml: vi.fn(),
  onInvestigate: vi.fn(),
  onCopyDescribe: vi.fn(),
  onRunDebugDescribe: vi.fn(),
  onCopyDebug: vi.fn(),
  onPreviousLogs: vi.fn(),
  onPortForward: vi.fn(),
  onEvict: vi.fn(),
  onDelete: vi.fn(),
  isDeleting: vi.fn(() => false),
  isEvicting: vi.fn(() => false),
  watcherEnabled: true,
  watcherRefreshSeconds: 30,
  watcherError: null,
  onToggleWatcher: vi.fn(),
  onWatcherRefreshSecondsChange: vi.fn(),
  onResetWatcherSettings: vi.fn(),
};

describe("pods data-table on a 492-pod cluster", () => {
  it("lists all 9 namespaces in the NS filter and counts every pod", async () => {
    const { container, getByRole, getByLabelText, queryByText } = render(DataTable, {
      props: { rows: buildLargeClusterRows(), ...baseProps },
    });

    expect(getByRole("button", { name: "NS (9/9)" })).toBeInTheDocument();
    expect(getRowsCounterText(container)).toBe("Rows: 492");
    expect(queryByText("Grouped view limit")).not.toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "NS (9/9)" }));
    await waitFor(() => {
      expect(getByLabelText("zz-batch")).toBeChecked();
    });
  }, 20_000);

  it("caps only the grouped view, and applies the cap after the NS filter", async () => {
    const { container, getByLabelText, getByRole, getByText } = render(DataTable, {
      props: { rows: buildLargeClusterRows(), ...baseProps },
    });

    await fireEvent.click(getByLabelText("Group by namespace"));

    expect(getByText("Grouped view limit")).toBeInTheDocument();
    expect(getByText(/shows the first 20 of 492 pods/)).toBeInTheDocument();
    expect(container.querySelectorAll(".pods-k9s-table__row")).toHaveLength(20);
    expect(getRenderedRowNamespaces(container).has("zz-batch")).toBe(false);

    await fireEvent.click(getByRole("button", { name: "NS (9/9)" }));
    await waitFor(() => {
      expect(getByRole("button", { name: "None" })).toBeInTheDocument();
    });
    await fireEvent.click(getByRole("button", { name: "None" }));
    await fireEvent.click(getByLabelText("zz-batch"));

    expect(getRowsCounterText(container)).toBe("Rows: 92");
    expect(getByText(/shows the first 20 of 92 pods/)).toBeInTheDocument();
    expect(container.querySelectorAll(".pods-k9s-table__row")).toHaveLength(20);
    expect([...getRenderedRowNamespaces(container)]).toEqual(["zz-batch"]);
  }, 20_000);

  it("offers Select all only the pods that passed search and the NS checklist", async () => {
    const rows = buildLargeClusterRows();
    const hiddenIds = new Set(
      rows.filter((row) => row.namespace === "zz-batch").map((row) => row.uid),
    );
    const onSelectableIdsChange = vi.fn();
    const onToggleAll = vi.fn();
    const { getByLabelText, getByRole, rerender } = render(DataTable, {
      props: { rows, ...baseProps, onSelectableIdsChange, onToggleAll },
    });
    const lastIds = () => (onSelectableIdsChange.mock.lastCall?.[0] ?? []) as string[];

    await waitFor(() => {
      expect(lastIds()).toHaveLength(492);
    });

    await fireEvent.click(getByRole("button", { name: "NS (9/9)" }));
    await waitFor(() => {
      expect(getByLabelText("zz-batch")).toBeInTheDocument();
    });
    await fireEvent.click(getByLabelText("zz-batch"));

    await waitFor(() => {
      expect(lastIds()).toHaveLength(400);
    });
    expect(lastIds().some((id) => hiddenIds.has(id))).toBe(false);

    await fireEvent.click(getByLabelText("Select all pods"));
    expect(onToggleAll).toHaveBeenCalledWith(true);

    await rerender({ rows: filterPodListRows(rows, "pod-01") });
    await waitFor(() => {
      expect(lastIds()).toEqual(Array.from({ length: 10 }, (_, index) => `pod-${10 + index}`));
    });

    await rerender({ rows });
    await fireEvent.click(getByLabelText("Group by namespace"));
    await waitFor(() => {
      expect(lastIds()).toHaveLength(20);
    });
  }, 20_000);

  it("reports the current page apart from the selectable pods", async () => {
    const onSelectableIdsChange = vi.fn();
    render(DataTable, {
      props: { rows: buildLargeClusterRows(), ...baseProps, onSelectableIdsChange },
    });

    await waitFor(() => {
      const [selectable, currentPage] = onSelectableIdsChange.mock.lastCall ?? [[], []];
      expect(selectable).toHaveLength(492);
      expect(currentPage).toHaveLength(100);
    });
  }, 20_000);
});
