import type { WorkloadType } from "$shared/model/workloads";
import type {
  WorkspaceLayout,
  WorkspacePaneId,
  WorkspacePaneState,
} from "./cluster-page-workspace";

export type DebugLogEntry = {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
};

export type WorkspaceRouteTraceEntry = {
  at: number;
  source: "left_menu" | "workspace" | "unknown";
  layoutMode: "pinned" | "temporary";
  route: string;
};

export type DraggedPaneTabPayload = {
  fromPaneId: WorkspacePaneId;
  tabId: string;
};

export function appendDebugLog(
  logs: DebugLogEntry[],
  level: DebugLogEntry["level"],
  message: string,
): DebugLogEntry[] {
  return [{ at: Date.now(), level, message }, ...logs].slice(0, 200);
}

export function workspaceLayoutBadge(layout: WorkspaceLayout | null | undefined): string {
  return `${layout ?? 1}P`;
}

export function buildRouteTraceEntry(params: {
  cluster: string;
  workload: WorkloadType | "overview";
  sortField: string;
  namespace: string;
  source: WorkspaceRouteTraceEntry["source"];
  layoutMode: WorkspaceRouteTraceEntry["layoutMode"];
}): WorkspaceRouteTraceEntry {
  return {
    at: Date.now(),
    source: params.source,
    layoutMode: params.layoutMode,
    route: `${params.cluster}?workload=${params.workload}&sort=${params.sortField}&ns=${params.namespace}`,
  };
}

export function appendRouteTrace(
  trace: WorkspaceRouteTraceEntry[],
  entry: WorkspaceRouteTraceEntry,
  limit: number,
): WorkspaceRouteTraceEntry[] {
  return [entry, ...trace].slice(0, limit);
}

export function formatSyncUpdatedAt(
  lastUpdatedAt: number,
  formatTimeDifference: (value: Date) => string,
): string {
  const compact = formatTimeDifference(new Date(lastUpdatedAt));
  return compact === "0s" ? "just now" : `${compact} ago`;
}

export function buildWorkspaceDebugSnapshot(params: {
  cluster: string;
  layout: WorkspaceLayout;
  workload: WorkloadType | "overview";
  sortField: string;
  namespace: string;
  panes: Record<WorkspacePaneId, WorkspacePaneState>;
  paneStatusLabel: (paneId: WorkspacePaneId) => "loading" | "error" | "ready";
}) {
  return {
    cluster: params.cluster,
    layout: params.layout,
    route: {
      workload: params.workload,
      sortField: params.sortField,
      namespace: params.namespace,
    },
    panes: {
      "pane-1": {
        workload: params.panes["pane-1"].workload,
        activeTabId: params.panes["pane-1"].activeTabId,
        status: params.paneStatusLabel("pane-1"),
      },
      "pane-2": {
        workload: params.panes["pane-2"].workload,
        activeTabId: params.panes["pane-2"].activeTabId,
        status: params.paneStatusLabel("pane-2"),
      },
      "pane-3": {
        workload: params.panes["pane-3"].workload,
        activeTabId: params.panes["pane-3"].activeTabId,
        status: params.paneStatusLabel("pane-3"),
      },
    },
    at: new Date().toISOString(),
  };
}

export function buildWorkspaceRouteTracePayload(
  cluster: string,
  trace: WorkspaceRouteTraceEntry[],
) {
  return {
    cluster,
    trace: trace.map((entry) => ({
      at: new Date(entry.at).toISOString(),
      source: entry.source,
      layoutMode: entry.layoutMode,
      route: entry.route,
    })),
  };
}

export function createDraggedPaneTabPayload(
  fromPaneId: WorkspacePaneId,
  tabId: string,
): DraggedPaneTabPayload {
  return { fromPaneId, tabId };
}

export function parseDraggedPaneTabPayload(raw: string): DraggedPaneTabPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<DraggedPaneTabPayload>;
    if (typeof candidate.fromPaneId !== "string" || typeof candidate.tabId !== "string") {
      return null;
    }
    return { fromPaneId: candidate.fromPaneId, tabId: candidate.tabId };
  } catch {
    return null;
  }
}
