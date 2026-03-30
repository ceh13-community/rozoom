import type {
  DashboardDataProfile,
  DashboardDataProfileId,
} from "$shared/lib/dashboard-data-profile.svelte";
import { buildDataModeWorkbenchStorageKey } from "../common/workbench-data-mode";

export type PodsWorkbenchLayout = "single" | "dual" | "triple";

export type PersistedPodsWorkbenchTab = {
  kind: "logs" | "yaml" | "events";
  name: string;
  namespace: string;
  pinned: boolean;
};

export type PersistedPodsClosedTab = {
  kind: "logs" | "yaml" | "events";
  target: { name: string; namespace: string } | null;
  pinned: boolean;
};

export type PersistedPodsWorkbenchState = {
  version: 1;
  tabs: PersistedPodsWorkbenchTab[];
  activeTabId: string | null;
  layout: PodsWorkbenchLayout;
  paneTabIds: [string | null, string | null, string | null];
  collapsedPaneIndexes: number[];
  closedTabs: PersistedPodsClosedTab[];
  workbenchCollapsed: boolean;
  workbenchFullscreen: boolean;
};

const KEY_PREFIX = "dashboard.pods.workbench.state.v1";

export function getLegacyPodsWorkbenchStateKey(clusterId: string) {
  return `${KEY_PREFIX}:${clusterId}`;
}

export function getPodsWorkbenchStateKey(
  clusterId: string,
  profile: DashboardDataProfile | DashboardDataProfileId,
) {
  return buildDataModeWorkbenchStorageKey(getLegacyPodsWorkbenchStateKey(clusterId), profile);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function parseLooseBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0" || normalized === "") return false;
  }
  return false;
}

export function parsePodsWorkbenchState(raw: string | null): PersistedPodsWorkbenchState | null {
  if (!raw) return null;
  try {
    const parsed = asRecord(JSON.parse(raw));
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tabs)) return null;

    const tabs = parsed.tabs
      .map((value) => asRecord(value))
      .flatMap((tab) => {
        if (!tab) return [];
        const kind = tab.kind;
        const name = tab.name;
        const namespace = tab.namespace;
        if (
          (kind !== "logs" && kind !== "yaml" && kind !== "events") ||
          typeof name !== "string" ||
          typeof namespace !== "string"
        ) {
          return [];
        }
        return [
          {
            kind,
            name,
            namespace,
            pinned: Boolean(tab.pinned),
          } satisfies PersistedPodsWorkbenchTab,
        ];
      });

    const paneTabIdsRaw = Array.isArray(parsed.paneTabIds) ? parsed.paneTabIds : [];
    const paneTabIds: [string | null, string | null, string | null] = [
      typeof paneTabIdsRaw[0] === "string" ? paneTabIdsRaw[0] : null,
      typeof paneTabIdsRaw[1] === "string" ? paneTabIdsRaw[1] : null,
      typeof paneTabIdsRaw[2] === "string" ? paneTabIdsRaw[2] : null,
    ];

    const closedTabsRaw = Array.isArray(parsed.closedTabs) ? parsed.closedTabs : [];
    const closedTabs = closedTabsRaw
      .map((value) => asRecord(value))
      .flatMap((entry) => {
        if (!entry) return [];
        const kind = entry.kind;
        if (kind !== "logs" && kind !== "yaml" && kind !== "events") return [];
        const targetRaw = asRecord(entry.target);
        const target =
          targetRaw && typeof targetRaw.name === "string" && typeof targetRaw.namespace === "string"
            ? { name: targetRaw.name, namespace: targetRaw.namespace }
            : null;
        return [{ kind, target, pinned: Boolean(entry.pinned) } satisfies PersistedPodsClosedTab];
      });

    const layoutRaw = parsed.layout;
    const layout: PodsWorkbenchLayout =
      layoutRaw === "single" || layoutRaw === "dual" || layoutRaw === "triple"
        ? layoutRaw
        : "single";

    const collapsedPaneIndexes = Array.isArray(parsed.collapsedPaneIndexes)
      ? parsed.collapsedPaneIndexes.filter(
          (value): value is number => Number.isInteger(value) && value >= 0,
        )
      : [];

    return {
      version: 1,
      tabs,
      activeTabId: typeof parsed.activeTabId === "string" ? parsed.activeTabId : null,
      layout,
      paneTabIds,
      collapsedPaneIndexes,
      closedTabs,
      workbenchCollapsed: parseLooseBoolean(parsed.workbenchCollapsed),
      workbenchFullscreen: parseLooseBoolean(parsed.workbenchFullscreen),
    };
  } catch {
    return null;
  }
}
