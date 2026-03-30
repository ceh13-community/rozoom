import { writable } from "svelte/store";
import { get } from "svelte/store";
import { readJsonFromStorage, writeJsonToStorage } from "./local-storage";

export type DashboardDataProfileId = "realtime" | "balanced" | "low_load" | "fleet" | "manual";

export type DashboardRuntimeBudget = {
  maxActiveClusters: number;
  maxWarmClusters: number;
  maxConcurrentConnections: number;
  maxConcurrentClusterRefreshes: number;
  maxConcurrentDiagnostics: number;
  maxConcurrentHeavyChecks: number;
  autoSuspendInactiveClusters: boolean;
  networkSensitivity: "fast" | "normal" | "slow" | "unstable";
  metricsReadPolicy: "reuse_only" | "cached" | "eager";
  capabilityDiscoveryMode: "lazy" | "background";
};

export type DashboardRuntimePlaneSettings = {
  resourceSyncEnabled: boolean;
  diagnosticsEnabled: boolean;
  metricsEnabled: boolean;
  capabilityDiscoveryEnabled: boolean;
};

export type DashboardDataProfile = {
  id: DashboardDataProfileId;
  label: string;
  description: string;
  preferStreamForCoreResources: boolean;
  minCoreRefreshSeconds: number;
  minDerivedRefreshSeconds: number;
  allowAutoDerivedRefresh: boolean;
  allowAutoDiagnostics: boolean;
  maxPrefetchConcurrency: number;
  maxDashboardCardAutoRefresh: number;
  runtimeBudget: DashboardRuntimeBudget;
};

type PersistedDashboardDataProfile = {
  profileId: DashboardDataProfileId;
};

type PersistedDashboardRuntimeControlPlane = {
  override: Partial<DashboardRuntimeBudget> & Partial<DashboardRuntimePlaneSettings>;
};

const DASHBOARD_DATA_PROFILE_STORAGE_KEY = "dashboard.data-profile.v1";
const DASHBOARD_RUNTIME_CONTROL_PLANE_STORAGE_KEY = "dashboard.runtime-control-plane.v1";
const DEFAULT_DASHBOARD_DATA_PROFILE_ID: DashboardDataProfileId = "balanced";

const DASHBOARD_DATA_PROFILES: Record<DashboardDataProfileId, DashboardDataProfile> = {
  realtime: {
    id: "realtime",
    label: "Realtime",
    description: "Stream-first core resources, fast refresh, higher API pressure.",
    preferStreamForCoreResources: true,
    minCoreRefreshSeconds: 10,
    minDerivedRefreshSeconds: 20,
    allowAutoDerivedRefresh: true,
    allowAutoDiagnostics: true,
    maxPrefetchConcurrency: 6,
    maxDashboardCardAutoRefresh: 8,
    runtimeBudget: {
      maxActiveClusters: 3,
      maxWarmClusters: 4,
      maxConcurrentConnections: 24,
      maxConcurrentClusterRefreshes: 6,
      maxConcurrentDiagnostics: 4,
      maxConcurrentHeavyChecks: 8,
      autoSuspendInactiveClusters: false,
      networkSensitivity: "fast",
      metricsReadPolicy: "eager",
      capabilityDiscoveryMode: "background",
    },
  },
  balanced: {
    id: "balanced",
    label: "Balanced",
    description: "Default mode with live core state and moderate background load.",
    preferStreamForCoreResources: true,
    minCoreRefreshSeconds: 30,
    minDerivedRefreshSeconds: 45,
    allowAutoDerivedRefresh: true,
    allowAutoDiagnostics: true,
    maxPrefetchConcurrency: 4,
    maxDashboardCardAutoRefresh: 8,
    runtimeBudget: {
      maxActiveClusters: 2,
      maxWarmClusters: 4,
      maxConcurrentConnections: 16,
      maxConcurrentClusterRefreshes: 5,
      maxConcurrentDiagnostics: 3,
      maxConcurrentHeavyChecks: 4,
      autoSuspendInactiveClusters: true,
      networkSensitivity: "normal",
      metricsReadPolicy: "cached",
      capabilityDiscoveryMode: "background",
    },
  },
  low_load: {
    id: "low_load",
    label: "Low Load",
    description: "Reduce request volume and background checks for weak links or slow APIs.",
    preferStreamForCoreResources: false,
    minCoreRefreshSeconds: 60,
    minDerivedRefreshSeconds: 120,
    allowAutoDerivedRefresh: false,
    allowAutoDiagnostics: false,
    maxPrefetchConcurrency: 1,
    maxDashboardCardAutoRefresh: 1,
    runtimeBudget: {
      maxActiveClusters: 1,
      maxWarmClusters: 2,
      maxConcurrentConnections: 6,
      maxConcurrentClusterRefreshes: 2,
      maxConcurrentDiagnostics: 1,
      maxConcurrentHeavyChecks: 1,
      autoSuspendInactiveClusters: true,
      networkSensitivity: "slow",
      metricsReadPolicy: "cached",
      capabilityDiscoveryMode: "lazy",
    },
  },
  fleet: {
    id: "fleet",
    label: "Fleet",
    description:
      "Background-summary mode for large fleets (50-100 clusters) with staggered refresh.",
    preferStreamForCoreResources: false,
    minCoreRefreshSeconds: 90,
    minDerivedRefreshSeconds: 180,
    allowAutoDerivedRefresh: false,
    allowAutoDiagnostics: false,
    maxPrefetchConcurrency: 2,
    maxDashboardCardAutoRefresh: 12,
    runtimeBudget: {
      maxActiveClusters: 1,
      maxWarmClusters: 4,
      maxConcurrentConnections: 20,
      maxConcurrentClusterRefreshes: 6,
      maxConcurrentDiagnostics: 2,
      maxConcurrentHeavyChecks: 2,
      autoSuspendInactiveClusters: true,
      networkSensitivity: "slow",
      metricsReadPolicy: "reuse_only",
      capabilityDiscoveryMode: "lazy",
    },
  },
  manual: {
    id: "manual",
    label: "Manual",
    description: "Disable automatic refresh and diagnostics. Refresh only on demand.",
    preferStreamForCoreResources: false,
    minCoreRefreshSeconds: 300,
    minDerivedRefreshSeconds: 300,
    allowAutoDerivedRefresh: false,
    allowAutoDiagnostics: false,
    maxPrefetchConcurrency: 1,
    maxDashboardCardAutoRefresh: 0,
    runtimeBudget: {
      maxActiveClusters: 1,
      maxWarmClusters: 1,
      maxConcurrentConnections: 2,
      maxConcurrentClusterRefreshes: 1,
      maxConcurrentDiagnostics: 0,
      maxConcurrentHeavyChecks: 0,
      autoSuspendInactiveClusters: true,
      networkSensitivity: "unstable",
      metricsReadPolicy: "reuse_only",
      capabilityDiscoveryMode: "lazy",
    },
  },
};

function isDashboardDataProfileId(value: unknown): value is DashboardDataProfileId {
  return (
    value === "realtime" ||
    value === "balanced" ||
    value === "low_load" ||
    value === "fleet" ||
    value === "manual"
  );
}

function isPersistedDashboardDataProfile(value: unknown): value is PersistedDashboardDataProfile {
  return Boolean(
    value &&
      typeof value === "object" &&
      isDashboardDataProfileId((value as PersistedDashboardDataProfile).profileId),
  );
}

function normalizeDashboardRuntimeBudgetOverride(
  override: Partial<DashboardRuntimeBudget>,
): Partial<DashboardRuntimeBudget> {
  const normalized: Partial<DashboardRuntimeBudget> = {};

  if (
    typeof override.maxActiveClusters === "number" &&
    Number.isFinite(override.maxActiveClusters)
  ) {
    normalized.maxActiveClusters = Math.max(1, Math.round(override.maxActiveClusters));
  }
  if (typeof override.maxWarmClusters === "number" && Number.isFinite(override.maxWarmClusters)) {
    normalized.maxWarmClusters = Math.max(0, Math.round(override.maxWarmClusters));
  }
  if (
    typeof override.maxConcurrentConnections === "number" &&
    Number.isFinite(override.maxConcurrentConnections)
  ) {
    normalized.maxConcurrentConnections = Math.max(
      1,
      Math.round(override.maxConcurrentConnections),
    );
  }
  if (
    typeof override.maxConcurrentClusterRefreshes === "number" &&
    Number.isFinite(override.maxConcurrentClusterRefreshes)
  ) {
    normalized.maxConcurrentClusterRefreshes = Math.max(
      1,
      Math.round(override.maxConcurrentClusterRefreshes),
    );
  }
  if (
    typeof override.maxConcurrentDiagnostics === "number" &&
    Number.isFinite(override.maxConcurrentDiagnostics)
  ) {
    normalized.maxConcurrentDiagnostics = Math.max(
      0,
      Math.round(override.maxConcurrentDiagnostics),
    );
  }
  if (
    typeof override.maxConcurrentHeavyChecks === "number" &&
    Number.isFinite(override.maxConcurrentHeavyChecks)
  ) {
    normalized.maxConcurrentHeavyChecks = Math.max(
      0,
      Math.round(override.maxConcurrentHeavyChecks),
    );
  }
  if (typeof override.autoSuspendInactiveClusters === "boolean") {
    normalized.autoSuspendInactiveClusters = override.autoSuspendInactiveClusters;
  }
  if (
    override.networkSensitivity === "fast" ||
    override.networkSensitivity === "normal" ||
    override.networkSensitivity === "slow" ||
    override.networkSensitivity === "unstable"
  ) {
    normalized.networkSensitivity = override.networkSensitivity;
  }
  if (
    override.metricsReadPolicy === "reuse_only" ||
    override.metricsReadPolicy === "cached" ||
    override.metricsReadPolicy === "eager"
  ) {
    normalized.metricsReadPolicy = override.metricsReadPolicy;
  }
  if (
    override.capabilityDiscoveryMode === "lazy" ||
    override.capabilityDiscoveryMode === "background"
  ) {
    normalized.capabilityDiscoveryMode = override.capabilityDiscoveryMode;
  }

  return normalized;
}

function normalizeDashboardRuntimePlaneOverride(
  override: Partial<DashboardRuntimePlaneSettings>,
): Partial<DashboardRuntimePlaneSettings> {
  const normalized: Partial<DashboardRuntimePlaneSettings> = {};

  if (typeof override.resourceSyncEnabled === "boolean") {
    normalized.resourceSyncEnabled = override.resourceSyncEnabled;
  }
  if (typeof override.diagnosticsEnabled === "boolean") {
    normalized.diagnosticsEnabled = override.diagnosticsEnabled;
  }
  if (typeof override.metricsEnabled === "boolean") {
    normalized.metricsEnabled = override.metricsEnabled;
  }
  if (typeof override.capabilityDiscoveryEnabled === "boolean") {
    normalized.capabilityDiscoveryEnabled = override.capabilityDiscoveryEnabled;
  }

  return normalized;
}

function sanitizeDashboardRuntimeControlPlaneOverride(
  override: Partial<DashboardRuntimeBudget> & Partial<DashboardRuntimePlaneSettings>,
) {
  return {
    ...normalizeDashboardRuntimeBudgetOverride(override),
    ...normalizeDashboardRuntimePlaneOverride(override),
  };
}

function isPersistedDashboardRuntimeControlPlane(
  value: unknown,
): value is PersistedDashboardRuntimeControlPlane {
  if (!value || typeof value !== "object") return false;
  if (!("override" in value) || !value.override || typeof value.override !== "object") return false;
  return true;
}

function resolveDashboardDataProfile(profileId: DashboardDataProfileId): DashboardDataProfile {
  return DASHBOARD_DATA_PROFILES[profileId];
}

function resolveProfileRecord(
  profile: DashboardDataProfile | DashboardDataProfileId,
): DashboardDataProfile {
  return typeof profile === "string" ? resolveDashboardDataProfile(profile) : profile;
}

function loadPersistedDashboardDataProfileId(): DashboardDataProfileId {
  const persisted = readJsonFromStorage<PersistedDashboardDataProfile>(
    DASHBOARD_DATA_PROFILE_STORAGE_KEY,
    {
      fallback: { profileId: DEFAULT_DASHBOARD_DATA_PROFILE_ID },
      validate: isPersistedDashboardDataProfile,
    },
  );
  return persisted.profileId;
}

function persistDashboardDataProfileId(profileId: DashboardDataProfileId) {
  writeJsonToStorage(DASHBOARD_DATA_PROFILE_STORAGE_KEY, { profileId });
}

const dashboardDataProfileStore = writable<DashboardDataProfile>(
  resolveDashboardDataProfile(DEFAULT_DASHBOARD_DATA_PROFILE_ID),
);
const dashboardRuntimeControlPlaneStore = writable<
  Partial<DashboardRuntimeBudget> & Partial<DashboardRuntimePlaneSettings>
>({});

let dashboardDataProfileHydrated = false;
let dashboardRuntimeControlPlaneHydrated = false;

export const dashboardDataProfile = {
  subscribe: dashboardDataProfileStore.subscribe,
};

export const dashboardRuntimeControlPlane = {
  subscribe: dashboardRuntimeControlPlaneStore.subscribe,
};

export function listDashboardDataProfiles(): DashboardDataProfile[] {
  return [
    DASHBOARD_DATA_PROFILES.realtime,
    DASHBOARD_DATA_PROFILES.balanced,
    DASHBOARD_DATA_PROFILES.low_load,
    DASHBOARD_DATA_PROFILES.fleet,
    DASHBOARD_DATA_PROFILES.manual,
  ];
}

export function hydrateDashboardDataProfile() {
  if (dashboardDataProfileHydrated) return;
  dashboardDataProfileHydrated = true;
  dashboardDataProfileStore.set(resolveDashboardDataProfile(loadPersistedDashboardDataProfileId()));
}

export function hydrateDashboardRuntimeControlPlane() {
  if (dashboardRuntimeControlPlaneHydrated) return;
  dashboardRuntimeControlPlaneHydrated = true;
  const persisted = readJsonFromStorage<PersistedDashboardRuntimeControlPlane>(
    DASHBOARD_RUNTIME_CONTROL_PLANE_STORAGE_KEY,
    {
      fallback: { override: {} },
      validate: isPersistedDashboardRuntimeControlPlane,
    },
  );
  dashboardRuntimeControlPlaneStore.set(
    sanitizeDashboardRuntimeControlPlaneOverride(persisted.override),
  );
}

export function setDashboardDataProfile(profileId: DashboardDataProfileId) {
  const next = resolveDashboardDataProfile(profileId);
  dashboardDataProfileHydrated = true;
  dashboardDataProfileStore.set(next);
  persistDashboardDataProfileId(next.id);
}

export function setDashboardRuntimeControlPlane(
  next: Partial<DashboardRuntimeBudget> & Partial<DashboardRuntimePlaneSettings>,
) {
  hydrateDashboardRuntimeControlPlane();
  dashboardRuntimeControlPlaneStore.update((current) => {
    const merged = sanitizeDashboardRuntimeControlPlaneOverride({ ...current, ...next });
    writeJsonToStorage(DASHBOARD_RUNTIME_CONTROL_PLANE_STORAGE_KEY, { override: merged });
    return merged;
  });
}

export function clearDashboardRuntimeControlPlane() {
  dashboardRuntimeControlPlaneHydrated = true;
  dashboardRuntimeControlPlaneStore.set({});
  writeJsonToStorage(DASHBOARD_RUNTIME_CONTROL_PLANE_STORAGE_KEY, { override: {} });
}

export function getDashboardDataProfile(): DashboardDataProfile {
  hydrateDashboardDataProfile();
  return get(dashboardDataProfileStore);
}

export function getDashboardRuntimeControlPlane() {
  hydrateDashboardRuntimeControlPlane();
  return get(dashboardRuntimeControlPlaneStore);
}

export function getDashboardDataProfileDisplayName(
  profile: DashboardDataProfile | DashboardDataProfileId,
): string {
  const resolved = resolveProfileRecord(profile);
  if (resolved.id === "realtime") return "Fast LAN";
  if (resolved.id === "balanced") return "Balanced";
  if (resolved.id === "low_load") return "Slow Internet / Limited API";
  if (resolved.id === "manual") return "Manual / Custom";
  return "Fleet Summary";
}

export function getDashboardDataProfileModeHint(
  profile: DashboardDataProfile | DashboardDataProfileId,
): string {
  const resolved = resolveProfileRecord(profile);
  if (resolved.id === "realtime") return "Stream-first, higher API pressure";
  if (resolved.id === "balanced") return "Live core state with bounded background load";
  if (resolved.id === "low_load") return "Reduced requests and stale-tolerant refresh";
  if (resolved.id === "manual") return "On-demand refresh only";
  return "Fleet-safe background summary mode";
}

export function resolveCoreResourceSyncPolicy(
  profile: DashboardDataProfile,
  options: {
    userEnabled: boolean;
    requestedRefreshSeconds: number;
    supportsStream: boolean;
    supportsPollingFallback?: boolean;
  },
) {
  const supportsPollingFallback = options.supportsPollingFallback ?? true;
  const requestedRefreshSeconds = Math.max(5, Math.round(options.requestedRefreshSeconds));

  if (!options.userEnabled || profile.id === "manual") {
    return {
      enabled: false,
      mode: "manual" as const,
      refreshSeconds: Math.max(requestedRefreshSeconds, profile.minCoreRefreshSeconds),
    };
  }

  const refreshSeconds = Math.max(requestedRefreshSeconds, profile.minCoreRefreshSeconds);
  const useStream =
    options.supportsStream && (profile.preferStreamForCoreResources || !supportsPollingFallback);

  return {
    enabled: true,
    mode: useStream ? ("stream" as const) : ("poll" as const),
    refreshSeconds,
  };
}

export function resolveDerivedRefreshPolicy(
  profile: DashboardDataProfile,
  options: {
    userEnabled: boolean;
    requestedRefreshSeconds: number;
  },
) {
  const requestedRefreshSeconds = Math.max(5, Math.round(options.requestedRefreshSeconds));
  const refreshSeconds = Math.max(requestedRefreshSeconds, profile.minDerivedRefreshSeconds);

  return {
    enabled: options.userEnabled && profile.id !== "manual" && profile.allowAutoDerivedRefresh,
    refreshSeconds,
  };
}

export function shouldAutoRunDiagnostics(profile: DashboardDataProfile): boolean {
  return profile.allowAutoDiagnostics && profile.id !== "manual";
}

export function resolvePrefetchConcurrency(
  profile: DashboardDataProfile,
  requestedMaxConcurrent: number,
): number {
  const requested = Math.max(1, Math.round(requestedMaxConcurrent));
  return Math.min(requested, profile.maxPrefetchConcurrency);
}

export function resolveDashboardCardAutoRefreshLimit(profile: DashboardDataProfile): number {
  return Math.max(0, Math.round(profile.maxDashboardCardAutoRefresh));
}

export function resolveClusterRuntimeBudget(profile: DashboardDataProfile): DashboardRuntimeBudget {
  hydrateDashboardRuntimeControlPlane();
  const override = get(dashboardRuntimeControlPlaneStore);
  return {
    ...profile.runtimeBudget,
    ...normalizeDashboardRuntimeBudgetOverride(override),
  };
}

export function resolveDashboardRuntimePlaneSettings(
  profile: DashboardDataProfile,
): DashboardRuntimePlaneSettings {
  hydrateDashboardRuntimeControlPlane();
  const override = get(dashboardRuntimeControlPlaneStore);
  return {
    resourceSyncEnabled: override.resourceSyncEnabled ?? true,
    diagnosticsEnabled: override.diagnosticsEnabled ?? shouldAutoRunDiagnostics(profile),
    metricsEnabled: override.metricsEnabled ?? shouldAutoRunDiagnostics(profile),
    capabilityDiscoveryEnabled: override.capabilityDiscoveryEnabled ?? true,
  };
}
