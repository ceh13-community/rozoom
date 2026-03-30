import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import DataTable from "./data-table.svelte";
import type { PodListRow } from "./model/pod-list-row";

function getRenderedPodNames(container: HTMLElement) {
  return [...container.querySelectorAll(".pods-k9s-table__row .font-medium.text-foreground")].map(
    (element) => element.textContent?.trim() ?? "",
  );
}

describe("pods data-table", () => {
  const baseProps = {
    query: "",
    onQueryChange: vi.fn(),
    enrichedTableEnabled: true,
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

  it("renders metrics recommendation as inline notice with link", () => {
    const rows: PodListRow[] = [
      {
        uid: "pod-1",
        name: "api-0",
        namespace: "default",
        status: "Running",
        readyContainers: 1,
        totalContainers: 1,
        restarts: 0,
        node: "minikube",
        age: "5m",
        ageSeconds: 300,
      },
    ];

    const { getByRole, getByText } = render(DataTable, {
      props: {
        rows,
        ...baseProps,
        metricsError: "[ERROR] Metrics API not available",
        metricsRecommendation: "Install metrics-server for CPU and memory metrics.",
      },
    });

    expect(getByRole("alert")).toHaveAttribute("data-variant", "destructive");
    expect(getByText("Live pod usage unavailable")).toBeInTheDocument();
    expect(getByText("Open Metrics Sources")).toHaveAttribute(
      "href",
      "/clusters/test?workload=metricssources",
    );
  });

  it("groups pods by node when the node grouping toggle is enabled", async () => {
    const rows: PodListRow[] = [
      {
        uid: "pod-1",
        name: "api-0",
        namespace: "default",
        status: "Running",
        readyContainers: 1,
        totalContainers: 1,
        restarts: 0,
        node: "node-a",
        age: "5m",
        ageSeconds: 300,
      },
      {
        uid: "pod-2",
        name: "worker-0",
        namespace: "jobs",
        status: "Running",
        readyContainers: 1,
        totalContainers: 1,
        restarts: 0,
        node: "node-b",
        age: "3m",
        ageSeconds: 180,
      },
    ];

    const { getAllByText, getByLabelText, getByRole, getByText } = render(DataTable, {
      props: {
        rows,
        ...baseProps,
      },
    });

    await fireEvent.click(getByLabelText("Group by node"));

    expect(getAllByText("node-a").length).toBeGreaterThan(0);
    expect(getAllByText("node-b").length).toBeGreaterThan(0);
    expect(getByRole("button", { name: "Collapse groups" })).toBeInTheDocument();
    expect(getByText("api-0")).toBeInTheDocument();
    expect(getByText("worker-0")).toBeInTheDocument();
  });

  it("sorts the flat pods grid when a sortable header is clicked", async () => {
    const rows: PodListRow[] = [
      {
        uid: "pod-1",
        name: "api-0",
        namespace: "default",
        status: "Running",
        readyContainers: 1,
        totalContainers: 1,
        restarts: 5,
        node: "node-a",
        age: "5m",
        ageSeconds: 300,
      },
      {
        uid: "pod-2",
        name: "worker-0",
        namespace: "jobs",
        status: "Running",
        readyContainers: 1,
        totalContainers: 1,
        restarts: 1,
        node: "node-b",
        age: "3m",
        ageSeconds: 180,
      },
    ];

    const { container, getByRole } = render(DataTable, {
      props: {
        rows,
        ...baseProps,
      },
    });

    await fireEvent.click(getByRole("button", { name: "Restarts" }));

    expect(getRenderedPodNames(container)).toEqual(["worker-0", "api-0"]);
  });
});
