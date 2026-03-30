import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "@tanstack/table-core";
import DataTable from "./data-table.svelte";

type Row = {
  uid: string;
  name: string;
  namespace: string;
  node: string;
  problemScore: number;
};

describe("deployments data-table", () => {
  it("labels grouped rows by node when node grouping is active", () => {
    const columns: ColumnDef<Row>[] = [
      { id: "problemScore", accessorKey: "problemScore", header: "Score" },
      { id: "name", accessorKey: "name", header: "Name" },
      { id: "namespace", accessorKey: "namespace", header: "Namespace" },
      { id: "node", accessorKey: "node", header: "Node" },
    ];

    const data: Row[] = [
      { uid: "dep-1", name: "api", namespace: "default", node: "node-a", problemScore: 10 },
      { uid: "dep-2", name: "worker", namespace: "jobs", node: "node-b", problemScore: 5 },
    ];

    const { getByText } = render(DataTable<Row>, {
      props: {
        columns,
        data,
        onRowClick: vi.fn(),
        isRowSelected: vi.fn(() => false),
        onToggleGroupSelection: vi.fn(),
        watcherEnabled: true,
        watcherRefreshSeconds: 30,
        watcherError: null,
        onToggleWatcher: vi.fn(),
        onWatcherRefreshSecondsChange: vi.fn(),
        onResetWatcherSettings: vi.fn(),
        viewMode: "node",
        onViewModeChange: vi.fn(),
        onCsvDownloaded: vi.fn(),
      },
    });

    expect(getByText("Node: node-a")).toBeInTheDocument();
    expect(getByText("Node: node-b")).toBeInTheDocument();
  });
});
