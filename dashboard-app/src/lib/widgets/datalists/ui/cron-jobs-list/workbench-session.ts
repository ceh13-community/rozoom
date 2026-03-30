export type CronJobsWorkbenchLayout = "single" | "dual" | "triple";

export type PersistedCronJobsWorkbenchTab = {
  kind: "logs" | "yaml";
  name: string;
  namespace: string;
  pinned: boolean;
};

export type PersistedCronJobsClosedTab = {
  kind: "logs" | "yaml";
  target: { name: string; namespace: string } | null;
  pinned: boolean;
};

export type PersistedCronJobsWorkbenchState = {
  version: 1;
  tabs: PersistedCronJobsWorkbenchTab[];
  activeTabId: string | null;
  layout: CronJobsWorkbenchLayout;
  paneTabIds: [string | null, string | null, string | null];
  collapsedPaneIndexes: number[];
  closedTabs: PersistedCronJobsClosedTab[];
  workbenchCollapsed: boolean;
  workbenchFullscreen: boolean;
};

const KEY_PREFIX = "dashboard.cronjobs.workbench.state.v1";

export function getCronJobsWorkbenchStateKey(clusterId: string) {
  return `${KEY_PREFIX}:${clusterId}`;
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

export function parseCronJobsWorkbenchState(
  raw: string | null,
): PersistedCronJobsWorkbenchState | null {
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
          (kind !== "logs" && kind !== "yaml") ||
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
          } satisfies PersistedCronJobsWorkbenchTab,
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
        if (kind !== "logs" && kind !== "yaml") return [];
        const targetRaw = asRecord(entry.target);
        const target =
          targetRaw && typeof targetRaw.name === "string" && typeof targetRaw.namespace === "string"
            ? { name: targetRaw.name, namespace: targetRaw.namespace }
            : null;
        return [
          { kind, target, pinned: Boolean(entry.pinned) } satisfies PersistedCronJobsClosedTab,
        ];
      });

    const layoutRaw = parsed.layout;
    const layout: CronJobsWorkbenchLayout =
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
