import type { WorkloadType } from "$shared/model/workloads";
import { toWorkloadLabel } from "./cluster-page-workload-config";

export type PinnedClusterTab = {
  id: string;
  clusterId: string;
  workload: string;
  sortField: string;
  label: string;
  href: string;
  pinnedAt: number;
};

export type WorkspaceLayout = 1 | 2 | 3;
export type WorkspacePaneId = "pane-1" | "pane-2" | "pane-3";
export type WorkspacePaneTab = {
  id: string;
  clusterId: string;
  workload: WorkloadType;
  sortField: string;
  label: string;
  pinnedAt: number;
};

export type WorkspacePaneState = {
  id: WorkspacePaneId;
  clusterId: string | null;
  workload: WorkloadType;
  sortField: string;
  tabs: WorkspacePaneTab[];
  activeTabId: string | null;
};

export type PinnedWorkspaceSession = {
  layout: WorkspaceLayout;
  panes: Record<WorkspacePaneId, WorkspacePaneState>;
};

export const MAX_PINNED_CLUSTER_TABS = 12;
export const WORKSPACE_MAX_TABS_PER_PANE = 12;

// @ts-expect-error includes types not yet in WorkloadType
const VALID_WORKLOADS: ReadonlySet<string> = new Set<WorkloadType>([
  "overview",
  "globaltriage",
  "pods",
  "deployments",
  "daemonsets",
  "statefulsets",
  "replicasets",
  "replicationcontrollers",
  "jobs",
  "cronjobs",
  "cronjobshealth",
  "podsrestarts",
  "deprecationscan",
  "versionaudit",
  "backupaudit",
  "alertshub",
  "armorhub",
  "metricssources",
  "compliancehub",
  "trivyhub",
  "helm",
  "helmcatalog",
  "nodesstatus",
  "nodespressures",
  "configmaps",
  "namespaces",
  "secrets",
  "resourcequotas",
  "limitranges",
  "horizontalpodautoscalers",
  "poddisruptionbudgets",
  "priorityclasses",
  "runtimeclasses",
  "leases",
  "mutatingwebhookconfigurations",
  "validatingwebhookconfigurations",
  "serviceaccounts",
  "roles",
  "rolebindings",
  "clusterroles",
  "clusterrolebindings",
  "accessreviews",
  "customresourcedefinitions",
  "services",
  "endpoints",
  "endpointslices",
  "ingresses",
  "ingressclasses",
  "gatewayclasses",
  "gateways",
  "httproutes",
  "referencegrants",
  "portforwarding",
  "networkpolicies",
  "persistentvolumeclaims",
  "persistentvolumes",
  "storageclasses",
  "volumeattributesclasses",
  "volumesnapshots",
  "volumesnapshotcontents",
  "volumesnapshotclasses",
  "csistoragecapacities",
  "rotatecerts",
  "gitopsbootstrap",
  "capacityintelligence",
  "performanceobs",
  "securityaudit",
  "authsecurity",
  "plugins",
  "visualizer",
  "resourcemap",
]);

function isValidWorkload(value: string): value is WorkloadType {
  return VALID_WORKLOADS.has(value);
}

export function pruneStalePins(
  tabs: PinnedClusterTab[],
  activeClusterIds: Set<string>,
): PinnedClusterTab[] {
  return tabs.filter((tab) => activeClusterIds.has(tab.clusterId));
}
export const WORKSPACE_PANE_IDS: WorkspacePaneId[] = ["pane-1", "pane-2", "pane-3"];

export function createDefaultWorkspacePanes(): Record<WorkspacePaneId, WorkspacePaneState> {
  return {
    "pane-1": {
      id: "pane-1",
      clusterId: null,
      workload: "overview",
      sortField: "name",
      tabs: [],
      activeTabId: null,
    },
    "pane-2": {
      id: "pane-2",
      clusterId: null,
      workload: "overview",
      sortField: "name",
      tabs: [],
      activeTabId: null,
    },
    "pane-3": {
      id: "pane-3",
      clusterId: null,
      workload: "overview",
      sortField: "name",
      tabs: [],
      activeTabId: null,
    },
  };
}

export function readPinnedTabs(storageKey: string): PinnedClusterTab[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item): item is PinnedClusterTab => {
        return (
          item !== null &&
          typeof item === "object" &&
          typeof (item as PinnedClusterTab).id === "string" &&
          typeof (item as PinnedClusterTab).clusterId === "string" &&
          typeof (item as PinnedClusterTab).workload === "string" &&
          typeof (item as PinnedClusterTab).sortField === "string" &&
          typeof (item as PinnedClusterTab).label === "string" &&
          typeof (item as PinnedClusterTab).href === "string" &&
          typeof (item as PinnedClusterTab).pinnedAt === "number"
        );
      })
      .slice(0, MAX_PINNED_CLUSTER_TABS);
  } catch {
    return [];
  }
}

export function savePinnedTabs(storageKey: string, next: PinnedClusterTab[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(next));
}

export function toClusterWorkloadHref(
  workload: WorkloadType,
  sort: string,
  clusterId: string,
): string {
  const params = new URLSearchParams();
  params.set("workload", workload);
  if (sort) params.set("sort_field", sort);
  return `/dashboard/clusters/${encodeURIComponent(clusterId)}?${params.toString()}`;
}

export function readWorkspaceLayout(storageKey: string): WorkspaceLayout {
  if (typeof window === "undefined") return 1;
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return 1;
  const value = Number(raw);
  if (value === 2 || value === 3) return value;
  return 1;
}

export function saveWorkspaceLayout(storageKey: string, next: WorkspaceLayout) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, String(next));
}

export function createPaneTab(
  clusterId: string,
  workload: WorkloadType,
  sortField: string,
  resolveClusterName: (clusterId: string) => string,
): WorkspacePaneTab {
  return {
    id: `${clusterId}::${workload}::${sortField}`,
    clusterId,
    workload,
    sortField,
    label: `${resolveClusterName(clusterId)} · ${toWorkloadLabel(workload)}`,
    pinnedAt: Date.now(),
  };
}

export function readWorkspacePanes(
  storageKey: string,
  fallback: Record<WorkspacePaneId, WorkspacePaneState>,
): Record<WorkspacePaneId, WorkspacePaneState> {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return fallback;

    const out: Record<WorkspacePaneId, WorkspacePaneState> = { ...fallback };
    for (const paneId of WORKSPACE_PANE_IDS) {
      const item = (parsed as Record<string, unknown>)[paneId];
      if (!item || typeof item !== "object") continue;
      const cast = item as WorkspacePaneState;
      const workload =
        typeof cast.workload === "string" && isValidWorkload(cast.workload)
          ? cast.workload
          : "overview";
      const sortField =
        typeof cast.sortField === "string" && cast.sortField.length > 0 ? cast.sortField : "name";
      out[paneId] = {
        id: paneId,
        clusterId: typeof cast.clusterId === "string" ? cast.clusterId : null,
        workload,
        sortField,
        tabs: Array.isArray(cast.tabs) ? cast.tabs.slice(0, WORKSPACE_MAX_TABS_PER_PANE) : [],
        activeTabId: cast.activeTabId || null,
      };
    }
    return out;
  } catch {
    return fallback;
  }
}

export function saveWorkspacePanes(
  storageKey: string,
  next: Record<WorkspacePaneId, WorkspacePaneState>,
) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(next));
}

export function cloneWorkspacePanes(
  panes: Record<WorkspacePaneId, WorkspacePaneState>,
): Record<WorkspacePaneId, WorkspacePaneState> {
  const out = {} as Record<WorkspacePaneId, WorkspacePaneState>;
  for (const paneId of WORKSPACE_PANE_IDS) {
    const pane = panes[paneId];
    out[paneId] = {
      ...pane,
      tabs: pane.tabs.map((tab) => ({ ...tab })),
    };
  }
  return out;
}

export function sameWorkspacePanes(
  left: Record<WorkspacePaneId, WorkspacePaneState>,
  right: Record<WorkspacePaneId, WorkspacePaneState>,
): boolean {
  for (const paneId of WORKSPACE_PANE_IDS) {
    const leftPane = left[paneId];
    const rightPane = right[paneId];
    if (leftPane.id !== rightPane.id) return false;
    if (leftPane.clusterId !== rightPane.clusterId) return false;
    if (leftPane.workload !== rightPane.workload) return false;
    if (leftPane.sortField !== rightPane.sortField) return false;
    if (leftPane.activeTabId !== rightPane.activeTabId) return false;
    if (leftPane.tabs.length !== rightPane.tabs.length) return false;

    for (let index = 0; index < leftPane.tabs.length; index += 1) {
      const leftTab = leftPane.tabs[index];
      const rightTab = rightPane.tabs[index];
      if (leftTab.id !== rightTab.id) return false;
      if (leftTab.clusterId !== rightTab.clusterId) return false;
      if (leftTab.workload !== rightTab.workload) return false;
      if (leftTab.sortField !== rightTab.sortField) return false;
      if (leftTab.label !== rightTab.label) return false;
    }
  }

  return true;
}

export function normalizeWorkspacePanes(
  next: Record<WorkspacePaneId, WorkspacePaneState>,
  clusterId: string,
  sortField: string,
  createTab: (clusterId: string, workload: WorkloadType, sortField: string) => WorkspacePaneTab,
): Record<WorkspacePaneId, WorkspacePaneState> {
  function normalizePaneState(pane: WorkspacePaneState): WorkspacePaneState {
    const seen = new Set<string>();
    const normalizedTabs: WorkspacePaneTab[] = [];
    const paneClusterId = pane.clusterId || clusterId;

    for (const tab of pane.tabs) {
      const normalizedSort = tab.sortField || pane.sortField || sortField || "name";
      const normalized = createTab(tab.clusterId || paneClusterId, tab.workload, normalizedSort);
      if (seen.has(normalized.id)) continue;
      seen.add(normalized.id);
      normalizedTabs.push(normalized);
      if (normalizedTabs.length >= WORKSPACE_MAX_TABS_PER_PANE) break;
    }

    const currentSort = pane.sortField || sortField || "name";
    const fallbackTab = createTab(paneClusterId, pane.workload, currentSort);
    const active = normalizedTabs.find((tab) => tab.id === pane.activeTabId) || fallbackTab;
    const tabs = normalizedTabs.length > 0 ? normalizedTabs : [fallbackTab];

    return {
      ...pane,
      clusterId: paneClusterId,
      workload: active.workload,
      sortField: active.sortField,
      tabs,
      activeTabId: active.id,
    };
  }

  return {
    "pane-1": normalizePaneState(next["pane-1"]),
    "pane-2": normalizePaneState(next["pane-2"]),
    "pane-3": normalizePaneState(next["pane-3"]),
  };
}

export function readPinnedWorkspaceSessions(
  storageKey: string,
  fallbackPanes: Record<WorkspacePaneId, WorkspacePaneState>,
  clusterId: string,
  sortField: string,
  createTab: (clusterId: string, workload: WorkloadType, sortField: string) => WorkspacePaneTab,
): Record<string, PinnedWorkspaceSession> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, PinnedWorkspaceSession> = {};
    for (const [tabId, sessionValue] of Object.entries(parsed as Record<string, unknown>)) {
      if (!sessionValue || typeof sessionValue !== "object") continue;
      const session = sessionValue as PinnedWorkspaceSession;
      const panesCandidate = typeof session.panes === "object" ? session.panes : fallbackPanes;
      out[tabId] = {
        layout: session.layout === 2 || session.layout === 3 ? session.layout : 1,
        panes: cloneWorkspacePanes(
          normalizeWorkspacePanes(panesCandidate, clusterId, sortField, createTab),
        ),
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function savePinnedWorkspaceSessions(
  storageKey: string,
  next: Record<string, PinnedWorkspaceSession>,
) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(next));
}
