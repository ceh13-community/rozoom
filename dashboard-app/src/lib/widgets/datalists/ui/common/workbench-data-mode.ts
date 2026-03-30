import type {
  DashboardDataProfile,
  DashboardDataProfileId,
} from "$shared/lib/dashboard-data-profile.svelte";

type WorkbenchVisibilityState = {
  workbenchCollapsed: boolean;
  collapsedPaneIndexes: number[];
};

function resolveProfileId(profile: DashboardDataProfile | DashboardDataProfileId) {
  return typeof profile === "string" ? profile : profile.id;
}

export function isRealtimeWorkbenchProfile(profile: DashboardDataProfile | DashboardDataProfileId) {
  return resolveProfileId(profile) === "realtime";
}

export function buildDataModeWorkbenchStorageKey(
  baseKey: string,
  profile: DashboardDataProfile | DashboardDataProfileId,
) {
  return `${baseKey}:${resolveProfileId(profile)}`;
}

export function normalizeWorkbenchVisibilityForDataMode(
  profile: DashboardDataProfile | DashboardDataProfileId,
  state: WorkbenchVisibilityState,
): WorkbenchVisibilityState {
  if (!isRealtimeWorkbenchProfile(profile)) {
    return {
      workbenchCollapsed: state.workbenchCollapsed,
      collapsedPaneIndexes: [...state.collapsedPaneIndexes],
    };
  }

  return {
    workbenchCollapsed: false,
    collapsedPaneIndexes: [],
  };
}
