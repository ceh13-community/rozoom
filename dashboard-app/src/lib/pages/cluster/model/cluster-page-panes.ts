import type { PageData } from "$entities/cluster";
import type { WorkloadType } from "$shared/model/workloads";
import type {
  WorkspacePaneId,
  WorkspacePaneState,
  WorkspacePaneTab,
} from "./cluster-page-workspace";
import { hasRenderableWorkloadData, toWorkloadLabel } from "./cluster-page-workload-config";

export function buildPanePageData(
  pane: WorkspacePaneState,
  fallbackClusterId: string,
  resolveClusterName: (clusterId: string) => string,
): PageData {
  const workloadLabel = toWorkloadLabel(pane.workload);
  const paneClusterId = pane.clusterId || fallbackClusterId;
  const paneClusterName = resolveClusterName(paneClusterId);
  const paneNamespace = "all";
  const paneFiltersKey = `${paneNamespace}::${pane.sortField || "name"}`;

  return {
    name: paneClusterName,
    slug: paneClusterId,
    workload: pane.workload,
    sort_field: pane.sortField,
    title: `${workloadLabel} - Cluster: ${paneClusterName}`,
    namespace: paneNamespace,
    filtersKey: paneFiltersKey,
  };
}

export function paneIndexLabel(paneId: WorkspacePaneId): string {
  if (paneId === "pane-1") return "Pane A";
  return paneId === "pane-2" ? "Pane B" : "Pane C";
}

export function paneHasEffectiveData(params: {
  paneId: WorkspacePaneId;
  pane: WorkspacePaneState;
  isPrimaryPaneRenderable: boolean;
  workloadData: unknown;
}): boolean {
  if (params.paneId === "pane-1") return params.isPrimaryPaneRenderable;
  return hasRenderableWorkloadData(params.pane.workload, params.workloadData);
}

export function paneStatusLabel(params: {
  paneId: WorkspacePaneId;
  hasData: boolean;
  isPrimaryLoading: boolean;
  isPrimaryError: boolean;
  paneLoading: boolean;
  paneError: boolean;
}): "loading" | "error" | "ready" {
  if (params.paneId === "pane-1") {
    if (params.isPrimaryLoading && !params.hasData) return "loading";
    if (params.isPrimaryError && !params.hasData) return "error";
    return "ready";
  }
  if (params.paneLoading && !params.hasData) return "loading";
  if (params.paneError && !params.hasData) return "error";
  return "ready";
}

export function paneStatusClass(status: "loading" | "error" | "ready"): string {
  if (status === "loading") return "text-amber-600 dark:text-amber-400";
  if (status === "error") return "text-red-500";
  return "text-green-600 dark:text-green-400";
}

export function buildSecondaryPaneState(params: {
  pane: WorkspacePaneState;
  nextTab: WorkspacePaneTab;
  tabs: WorkspacePaneTab[];
}): Partial<WorkspacePaneState> {
  return {
    clusterId: params.nextTab.clusterId,
    workload: params.nextTab.workload,
    sortField: params.nextTab.sortField,
    tabs: params.tabs,
    activeTabId: params.nextTab.id,
  };
}

export function buildPaneTabList(
  nextTab: WorkspacePaneTab,
  existingTabs: WorkspacePaneTab[],
  maxTabs: number,
): WorkspacePaneTab[] {
  return [nextTab, ...existingTabs.filter((item) => item.id !== nextTab.id)].slice(0, maxTabs);
}

export function findPaneTab(pane: WorkspacePaneState, tabId: string): WorkspacePaneTab | null {
  return pane.tabs.find((item) => item.id === tabId) ?? null;
}

export function buildClosedPaneState(params: {
  paneId: WorkspacePaneId;
  pane: WorkspacePaneState;
  tabId: string;
  fallbackClusterId: string;
  fallbackWorkload: WorkloadType;
  fallbackSortField: string;
}): {
  nextTabs: WorkspacePaneTab[];
  nextActive: WorkspacePaneTab | null;
  nextState: Partial<WorkspacePaneState>;
} {
  const nextTabs = params.pane.tabs.filter((item) => item.id !== params.tabId);
  const hasNextActive = nextTabs.length > 0;
  const nextActive = hasNextActive ? nextTabs[0] : null;

  if (params.paneId === "pane-1") {
    return {
      nextTabs,
      nextActive,
      nextState: {
        tabs: nextTabs,
        activeTabId: hasNextActive ? nextTabs[0].id : null,
        clusterId: hasNextActive ? nextTabs[0].clusterId : params.fallbackClusterId,
        workload: hasNextActive ? nextTabs[0].workload : params.fallbackWorkload,
        sortField: hasNextActive ? nextTabs[0].sortField : params.fallbackSortField,
      },
    };
  }

  return {
    nextTabs,
    nextActive,
    nextState: {
      tabs: nextTabs,
      activeTabId: hasNextActive ? nextTabs[0].id : null,
      clusterId: hasNextActive ? nextTabs[0].clusterId : params.pane.clusterId,
      workload: hasNextActive ? nextTabs[0].workload : params.pane.workload,
      sortField: hasNextActive ? nextTabs[0].sortField : params.pane.sortField,
    },
  };
}
