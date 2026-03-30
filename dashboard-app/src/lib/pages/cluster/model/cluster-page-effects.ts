import type {
  PinnedWorkspaceSession,
  WorkspaceLayout,
  WorkspacePaneState,
  WorkspacePaneTab,
} from "./cluster-page-workspace";
import type { WorkloadType } from "$shared/model/workloads";
import type { ClusterSyncStatus } from "./cluster-page-sync-status";

export function buildWorkspaceRouteKey(
  clusterId: string,
  workload: WorkloadType,
  sortField: string,
): string {
  return `${clusterId}::${workload}::${sortField}`;
}

export function resolveWorkspaceNavigationSource(
  nextNavigationSource: "workspace" | null,
): "left_menu" | "workspace" {
  return nextNavigationSource === "workspace" ? "workspace" : "left_menu";
}

export function buildPinnedSessionRestore(params: {
  session: PinnedWorkspaceSession | undefined;
  workspaceLayout: WorkspaceLayout;
}):
  | { type: "persist-current"; transientWorkspaceLayout: WorkspaceLayout }
  | {
      type: "restore-session";
      nextLayout: WorkspaceLayout;
    } {
  if (!params.session) {
    return {
      type: "persist-current",
      transientWorkspaceLayout: params.workspaceLayout,
    };
  }

  return {
    type: "restore-session",
    nextLayout:
      params.session.layout === 2 || params.session.layout === 3 ? params.session.layout : 1,
  };
}

export function prunePinnedWorkspaceSessions(
  pinnedIds: string[],
  sessions: Record<string, PinnedWorkspaceSession>,
): { changed: boolean; nextSessions: Record<string, PinnedWorkspaceSession> } {
  const allowed = new Set(pinnedIds);
  const nextSessions: Record<string, PinnedWorkspaceSession> = {};
  let changed = false;

  for (const [tabId, session] of Object.entries(sessions)) {
    if (!allowed.has(tabId)) {
      changed = true;
      continue;
    }
    nextSessions[tabId] = session;
  }

  return { changed, nextSessions };
}

export function buildPrimaryPaneRouteState(params: {
  current: WorkspacePaneState;
  routeTab: WorkspacePaneTab;
  maxTabs: number;
}): { same: boolean; nextState: WorkspacePaneState } {
  const nextTabs = [
    params.routeTab,
    ...params.current.tabs.filter((item) => item.id !== params.routeTab.id),
  ].slice(0, params.maxTabs);

  const same =
    params.current.clusterId === params.routeTab.clusterId &&
    params.current.workload === params.routeTab.workload &&
    params.current.sortField === params.routeTab.sortField &&
    params.current.activeTabId === params.routeTab.id &&
    params.current.tabs.length === nextTabs.length &&
    params.current.tabs.every((item, index) => item.id === nextTabs[index]?.id);

  return {
    same,
    nextState: {
      ...params.current,
      clusterId: params.routeTab.clusterId,
      workload: params.routeTab.workload,
      sortField: params.routeTab.sortField,
      tabs: nextTabs,
      activeTabId: params.routeTab.id,
    },
  };
}

export function buildRouteDebugKey(
  workload: WorkloadType | undefined,
  sortField: string,
  namespace: string,
): string {
  return `${workload}|${sortField}|${namespace}`;
}

export function buildOverviewSyncDebugEvent(
  status: ClusterSyncStatus,
): { level: "info" | "warn" | "error"; message: string } | null {
  if (status.error) {
    return { level: "error", message: `Overview sync error: ${status.error}` };
  }
  if (status.partialMessage && status.lastUpdatedAt) {
    return {
      level: "warn",
      message: `Overview sync partial at ${new Date(status.lastUpdatedAt).toISOString()}: ${status.partialMessage}`,
    };
  }
  if (status.isLoading && !status.lastUpdatedAt) {
    return { level: "info", message: "Overview sync is loading" };
  }
  if (status.lastUpdatedAt) {
    return {
      level: "info",
      message: `Overview sync updated at ${new Date(status.lastUpdatedAt).toISOString()}`,
    };
  }
  return null;
}
