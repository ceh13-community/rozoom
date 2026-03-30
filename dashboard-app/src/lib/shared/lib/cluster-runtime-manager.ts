import { derived, get, writable, type Readable } from "svelte/store";
import { readJsonFromStorage, removeStorageKey, writeJsonToStorage } from "./local-storage";

export type ClusterRuntimePlane =
  | "resource_sync"
  | "diagnostics"
  | "metrics"
  | "capability_discovery";

export type ClusterRuntimeState = "active" | "warm" | "background" | "offline" | "degraded";

export type ClusterRuntimeContext = {
  activeClusterId: string | null;
  warmClusterIds: string[];
  degradedClusterIds: string[];
  offlineClusterIds: string[];
  resourceSyncEnabled: boolean;
  diagnosticsEnabled: boolean;
  metricsEnabled: boolean;
  capabilityDiscoveryEnabled: boolean;
};

export type ClusterRuntimeBudget = {
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

export type ClusterRuntimeOverride = Partial<ClusterRuntimeBudget> &
  Partial<
    Pick<
      ClusterRuntimeContext,
      "resourceSyncEnabled" | "diagnosticsEnabled" | "metricsEnabled" | "capabilityDiscoveryEnabled"
    >
  > & {
    state?: ClusterRuntimeState;
  };

type PersistedClusterRuntimeOverrides = {
  overrides: Record<string, ClusterRuntimeOverride>;
};

const CLUSTER_RUNTIME_OVERRIDES_STORAGE_KEY = "dashboard.cluster-runtime-overrides.v1";

const DEFAULT_CLUSTER_RUNTIME_CONTEXT: ClusterRuntimeContext = {
  activeClusterId: null,
  warmClusterIds: [],
  degradedClusterIds: [],
  offlineClusterIds: [],
  resourceSyncEnabled: true,
  diagnosticsEnabled: true,
  metricsEnabled: true,
  capabilityDiscoveryEnabled: true,
};

const DEFAULT_CLUSTER_RUNTIME_BUDGET: ClusterRuntimeBudget = {
  maxActiveClusters: 1,
  maxWarmClusters: 2,
  maxConcurrentConnections: 12,
  maxConcurrentClusterRefreshes: 3,
  maxConcurrentDiagnostics: 3,
  maxConcurrentHeavyChecks: 4,
  autoSuspendInactiveClusters: true,
  networkSensitivity: "normal",
  metricsReadPolicy: "cached",
  capabilityDiscoveryMode: "background",
};

function normalizeClusterId(clusterId: string | null | undefined) {
  const normalized = typeof clusterId === "string" ? clusterId.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeClusterIdList(
  clusterIds: Array<string | null | undefined>,
  exclude?: string | null,
) {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const candidate of clusterIds) {
    const clusterId = normalizeClusterId(candidate);
    if (!clusterId || clusterId === exclude || seen.has(clusterId)) continue;
    seen.add(clusterId);
    normalized.push(clusterId);
  }

  return normalized;
}

function normalizeClusterRuntimeBudget(
  current: ClusterRuntimeBudget,
  next: Partial<ClusterRuntimeBudget>,
): ClusterRuntimeBudget {
  return {
    maxActiveClusters: Math.max(1, Math.round(next.maxActiveClusters ?? current.maxActiveClusters)),
    maxWarmClusters: Math.max(0, Math.round(next.maxWarmClusters ?? current.maxWarmClusters)),
    maxConcurrentConnections: Math.max(
      1,
      Math.round(next.maxConcurrentConnections ?? current.maxConcurrentConnections),
    ),
    maxConcurrentClusterRefreshes: Math.max(
      1,
      Math.round(next.maxConcurrentClusterRefreshes ?? current.maxConcurrentClusterRefreshes),
    ),
    maxConcurrentDiagnostics: Math.max(
      0,
      Math.round(next.maxConcurrentDiagnostics ?? current.maxConcurrentDiagnostics),
    ),
    maxConcurrentHeavyChecks: Math.max(
      0,
      Math.round(next.maxConcurrentHeavyChecks ?? current.maxConcurrentHeavyChecks),
    ),
    autoSuspendInactiveClusters:
      next.autoSuspendInactiveClusters ?? current.autoSuspendInactiveClusters,
    networkSensitivity: next.networkSensitivity ?? current.networkSensitivity,
    metricsReadPolicy: next.metricsReadPolicy ?? current.metricsReadPolicy,
    capabilityDiscoveryMode: next.capabilityDiscoveryMode ?? current.capabilityDiscoveryMode,
  };
}

function isClusterRuntimeState(value: unknown): value is ClusterRuntimeState {
  return (
    value === "active" ||
    value === "warm" ||
    value === "background" ||
    value === "offline" ||
    value === "degraded"
  );
}

function isClusterRuntimeOverride(value: unknown): value is ClusterRuntimeOverride {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if ("state" in record && record.state !== undefined && !isClusterRuntimeState(record.state)) {
    return false;
  }
  return true;
}

function isPersistedClusterRuntimeOverrides(
  value: unknown,
): value is PersistedClusterRuntimeOverrides {
  if (typeof value !== "object" || value === null) return false;
  const overrides = (value as { overrides?: unknown }).overrides;
  if (!overrides || typeof overrides !== "object") return false;

  return Object.entries(overrides).every(
    ([clusterId, override]) =>
      Boolean(normalizeClusterId(clusterId)) && isClusterRuntimeOverride(override),
  );
}

function sanitizeClusterRuntimeOverride(
  override: ClusterRuntimeOverride | undefined,
): ClusterRuntimeOverride | null {
  if (!override) return null;

  const sanitized: ClusterRuntimeOverride = {};

  if (typeof override.resourceSyncEnabled === "boolean") {
    sanitized.resourceSyncEnabled = override.resourceSyncEnabled;
  }
  if (typeof override.diagnosticsEnabled === "boolean") {
    sanitized.diagnosticsEnabled = override.diagnosticsEnabled;
  }
  if (typeof override.metricsEnabled === "boolean") {
    sanitized.metricsEnabled = override.metricsEnabled;
  }
  if (typeof override.capabilityDiscoveryEnabled === "boolean") {
    sanitized.capabilityDiscoveryEnabled = override.capabilityDiscoveryEnabled;
  }
  if (
    typeof override.maxActiveClusters === "number" &&
    Number.isFinite(override.maxActiveClusters)
  ) {
    sanitized.maxActiveClusters = Math.max(1, Math.round(override.maxActiveClusters));
  }
  if (typeof override.maxWarmClusters === "number" && Number.isFinite(override.maxWarmClusters)) {
    sanitized.maxWarmClusters = Math.max(0, Math.round(override.maxWarmClusters));
  }
  if (
    typeof override.maxConcurrentConnections === "number" &&
    Number.isFinite(override.maxConcurrentConnections)
  ) {
    sanitized.maxConcurrentConnections = Math.max(1, Math.round(override.maxConcurrentConnections));
  }
  if (
    typeof override.maxConcurrentClusterRefreshes === "number" &&
    Number.isFinite(override.maxConcurrentClusterRefreshes)
  ) {
    sanitized.maxConcurrentClusterRefreshes = Math.max(
      1,
      Math.round(override.maxConcurrentClusterRefreshes),
    );
  }
  if (
    typeof override.maxConcurrentDiagnostics === "number" &&
    Number.isFinite(override.maxConcurrentDiagnostics)
  ) {
    sanitized.maxConcurrentDiagnostics = Math.max(0, Math.round(override.maxConcurrentDiagnostics));
  }
  if (
    typeof override.maxConcurrentHeavyChecks === "number" &&
    Number.isFinite(override.maxConcurrentHeavyChecks)
  ) {
    sanitized.maxConcurrentHeavyChecks = Math.max(0, Math.round(override.maxConcurrentHeavyChecks));
  }
  if (typeof override.autoSuspendInactiveClusters === "boolean") {
    sanitized.autoSuspendInactiveClusters = override.autoSuspendInactiveClusters;
  }
  if (
    override.networkSensitivity === "fast" ||
    override.networkSensitivity === "normal" ||
    override.networkSensitivity === "slow" ||
    override.networkSensitivity === "unstable"
  ) {
    sanitized.networkSensitivity = override.networkSensitivity;
  }
  if (
    override.metricsReadPolicy === "reuse_only" ||
    override.metricsReadPolicy === "cached" ||
    override.metricsReadPolicy === "eager"
  ) {
    sanitized.metricsReadPolicy = override.metricsReadPolicy;
  }
  if (
    override.capabilityDiscoveryMode === "lazy" ||
    override.capabilityDiscoveryMode === "background"
  ) {
    sanitized.capabilityDiscoveryMode = override.capabilityDiscoveryMode;
  }
  if (isClusterRuntimeState(override.state)) {
    sanitized.state = override.state;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function persistClusterRuntimeOverrides(overrides: Record<string, ClusterRuntimeOverride>) {
  if (Object.keys(overrides).length === 0) {
    removeStorageKey(CLUSTER_RUNTIME_OVERRIDES_STORAGE_KEY);
    return;
  }
  writeJsonToStorage(CLUSTER_RUNTIME_OVERRIDES_STORAGE_KEY, { overrides });
}

function loadClusterRuntimeOverrides(): Record<string, ClusterRuntimeOverride> {
  const persisted = readJsonFromStorage<PersistedClusterRuntimeOverrides>(
    CLUSTER_RUNTIME_OVERRIDES_STORAGE_KEY,
    {
      fallback: { overrides: {} },
      validate: isPersistedClusterRuntimeOverrides,
    },
  );

  return persisted.overrides;
}

const clusterRuntimeContextStore = writable<ClusterRuntimeContext>(DEFAULT_CLUSTER_RUNTIME_CONTEXT);
const clusterRuntimeBudgetStore = writable<ClusterRuntimeBudget>(DEFAULT_CLUSTER_RUNTIME_BUDGET);
const clusterRuntimeOverridesStore = writable<Record<string, ClusterRuntimeOverride>>({});
let clusterRuntimeOverridesHydrated = false;

export const clusterRuntimeContext = {
  subscribe: clusterRuntimeContextStore.subscribe,
};

export const clusterRuntimeBudget = {
  subscribe: clusterRuntimeBudgetStore.subscribe,
};

export const clusterRuntimeOverrides = {
  subscribe: clusterRuntimeOverridesStore.subscribe,
};

export function hydrateClusterRuntimeOverrides() {
  if (clusterRuntimeOverridesHydrated) return;
  clusterRuntimeOverridesHydrated = true;
  clusterRuntimeOverridesStore.set(loadClusterRuntimeOverrides());
}

function getClusterRuntimeOverridesSnapshot() {
  if (clusterRuntimeOverridesHydrated) {
    return get(clusterRuntimeOverridesStore);
  }

  return loadClusterRuntimeOverrides();
}

export function setClusterRuntimeContext(next: Partial<ClusterRuntimeContext>) {
  clusterRuntimeContextStore.update((current) => {
    const activeClusterId =
      "activeClusterId" in next
        ? normalizeClusterId(next.activeClusterId)
        : current.activeClusterId;

    return {
      ...current,
      ...next,
      activeClusterId,
      warmClusterIds:
        "warmClusterIds" in next
          ? normalizeClusterIdList(next.warmClusterIds ?? [], activeClusterId)
          : current.warmClusterIds,
      degradedClusterIds:
        "degradedClusterIds" in next
          ? normalizeClusterIdList(next.degradedClusterIds ?? [], null)
          : current.degradedClusterIds,
      offlineClusterIds:
        "offlineClusterIds" in next
          ? normalizeClusterIdList(next.offlineClusterIds ?? [], null)
          : current.offlineClusterIds,
    };
  });
}

export function setClusterRuntimeDegraded(clusterId: string, degraded: boolean) {
  const normalizedClusterId = normalizeClusterId(clusterId);
  if (!normalizedClusterId) return;

  clusterRuntimeContextStore.update((current) => {
    const nextDegradedClusterIds = degraded
      ? normalizeClusterIdList([...current.degradedClusterIds, normalizedClusterId], null)
      : current.degradedClusterIds.filter((value) => value !== normalizedClusterId);

    if (
      nextDegradedClusterIds.length === current.degradedClusterIds.length &&
      nextDegradedClusterIds.every((value, index) => value === current.degradedClusterIds[index])
    ) {
      return current;
    }

    return {
      ...current,
      degradedClusterIds: nextDegradedClusterIds,
    };
  });
}

export function resetClusterRuntimeContext() {
  clusterRuntimeContextStore.set(DEFAULT_CLUSTER_RUNTIME_CONTEXT);
  clusterRuntimeBudgetStore.set(DEFAULT_CLUSTER_RUNTIME_BUDGET);
  clusterRuntimeOverridesStore.set({});
  clusterRuntimeOverridesHydrated = false;
  removeStorageKey(CLUSTER_RUNTIME_OVERRIDES_STORAGE_KEY);
}

export function setClusterRuntimeBudget(next: Partial<ClusterRuntimeBudget>) {
  clusterRuntimeBudgetStore.update((current) => normalizeClusterRuntimeBudget(current, next));
}

export function setClusterRuntimeOverride(clusterId: string, next: ClusterRuntimeOverride) {
  const normalizedClusterId = normalizeClusterId(clusterId);
  if (!normalizedClusterId) return;

  hydrateClusterRuntimeOverrides();
  clusterRuntimeOverridesStore.update((current) => {
    const merged = sanitizeClusterRuntimeOverride({
      ...(current[normalizedClusterId] ?? {}),
      ...next,
    });
    const updated = { ...current };
    if (merged) {
      updated[normalizedClusterId] = merged;
    } else {
      const { [normalizedClusterId]: removedValue, ...rest } = updated;
      void removedValue;
      persistClusterRuntimeOverrides(rest);
      return rest;
    }
    persistClusterRuntimeOverrides(updated);
    return updated;
  });
}

export function clearClusterRuntimeOverride(clusterId: string) {
  const normalizedClusterId = normalizeClusterId(clusterId);
  if (!normalizedClusterId) return;

  hydrateClusterRuntimeOverrides();
  clusterRuntimeOverridesStore.update((current) => {
    if (!(normalizedClusterId in current)) return current;
    const { [normalizedClusterId]: removedValue, ...updated } = current;
    void removedValue;
    persistClusterRuntimeOverrides(updated);
    return updated;
  });
}

export function listClusterRuntimeOverrides() {
  return { ...getClusterRuntimeOverridesSnapshot() };
}

function resolveBaseClusterRuntimeState(
  context: ClusterRuntimeContext,
  clusterId: string,
): ClusterRuntimeState {
  if (context.offlineClusterIds.includes(clusterId)) return "offline";
  if (context.activeClusterId === clusterId) {
    if (context.degradedClusterIds.includes(clusterId)) return "degraded";
    return "active";
  }
  if (context.degradedClusterIds.includes(clusterId)) return "degraded";
  if (context.warmClusterIds.includes(clusterId)) return "warm";
  return "background";
}

export function resolveClusterRuntimeState(clusterId: string): ClusterRuntimeState {
  const normalizedClusterId = normalizeClusterId(clusterId);
  if (!normalizedClusterId) return "offline";

  const overrides = getClusterRuntimeOverridesSnapshot();
  if (normalizedClusterId in overrides) {
    const override = overrides[normalizedClusterId];
    if (override.state) return override.state;
  }

  return resolveBaseClusterRuntimeState(get(clusterRuntimeContextStore), normalizedClusterId);
}

export function resolveClusterRuntimeBudgetForCluster(clusterId: string): ClusterRuntimeBudget {
  const baseBudget = get(clusterRuntimeBudgetStore);
  const normalizedClusterId = normalizeClusterId(clusterId);
  if (!normalizedClusterId) return baseBudget;

  const overrides = getClusterRuntimeOverridesSnapshot();
  if (!(normalizedClusterId in overrides)) return baseBudget;
  return normalizeClusterRuntimeBudget(baseBudget, overrides[normalizedClusterId]);
}

function isPlaneEnabledInContext(context: ClusterRuntimeContext, plane: ClusterRuntimePlane) {
  if (plane === "resource_sync") return context.resourceSyncEnabled;
  if (plane === "diagnostics") return context.diagnosticsEnabled;
  if (plane === "metrics") return context.metricsEnabled;
  return context.capabilityDiscoveryEnabled;
}

function isPlaneEnabledInOverride(
  override: ClusterRuntimeOverride | undefined,
  plane: ClusterRuntimePlane,
) {
  if (!override) return undefined;
  if (plane === "resource_sync") return override.resourceSyncEnabled;
  if (plane === "diagnostics") return override.diagnosticsEnabled;
  if (plane === "metrics") return override.metricsEnabled;
  return override.capabilityDiscoveryEnabled;
}

export function isClusterRuntimePlaneActive(
  clusterId: string,
  plane: ClusterRuntimePlane,
): boolean {
  const normalizedClusterId = normalizeClusterId(clusterId);
  if (!normalizedClusterId) return false;

  const context = get(clusterRuntimeContextStore);
  const override = getClusterRuntimeOverridesSnapshot()[normalizedClusterId];
  const state = resolveClusterRuntimeState(normalizedClusterId);
  const budget = resolveClusterRuntimeBudgetForCluster(normalizedClusterId);
  const planeEnabled =
    isPlaneEnabledInOverride(override, plane) ?? isPlaneEnabledInContext(context, plane);

  if (!planeEnabled) return false;
  if (state === "offline") return false;

  if (state === "background") {
    return (
      plane === "capability_discovery" &&
      budget.capabilityDiscoveryMode === "background" &&
      !budget.autoSuspendInactiveClusters
    );
  }

  if (state === "warm") {
    return plane === "capability_discovery" && budget.capabilityDiscoveryMode === "background";
  }

  if (state === "degraded") {
    if (plane === "metrics") return false;
    if (plane === "diagnostics") return budget.maxConcurrentHeavyChecks > 0;
    return true;
  }

  return true;
}

function selectClusterIdsForPlane(plane: ClusterRuntimePlane): Readable<string[]> {
  return derived(
    [clusterRuntimeContextStore, clusterRuntimeBudgetStore, clusterRuntimeOverridesStore],
    ([$context, $budget]) => {
      const budgetedWarmClusterIds = $context.warmClusterIds.slice(0, $budget.maxWarmClusters);
      const candidates = normalizeClusterIdList(
        [
          $context.activeClusterId,
          ...budgetedWarmClusterIds,
          ...$context.degradedClusterIds,
          ...$context.offlineClusterIds,
        ],
        null,
      );

      return candidates.filter((clusterId) => isClusterRuntimePlaneActive(clusterId, plane));
    },
  );
}

export const activeResourceSyncClusterIds = selectClusterIdsForPlane("resource_sync");
export const activeDiagnosticsClusterIds = selectClusterIdsForPlane("diagnostics");
export const activeMetricsClusterIds = selectClusterIdsForPlane("metrics");
export const activeCapabilityDiscoveryClusterIds = selectClusterIdsForPlane("capability_discovery");

export function isClusterRuntimeHeavyDiagnosticsActive(clusterId: string): boolean {
  const normalizedClusterId = normalizeClusterId(clusterId);
  if (!normalizedClusterId) return false;

  const context = get(clusterRuntimeContextStore);
  const budget = resolveClusterRuntimeBudgetForCluster(clusterId);
  if (!context.activeClusterId) {
    const overrides = getClusterRuntimeOverridesSnapshot();
    const override = normalizedClusterId in overrides ? overrides[normalizedClusterId] : undefined;
    const state = override?.state;
    if (state === "offline") return false;
    if (state === "warm" || state === "background") return false;
    return (
      (isPlaneEnabledInOverride(override, "diagnostics") ?? context.diagnosticsEnabled) &&
      budget.maxConcurrentHeavyChecks > 0
    );
  }

  return (
    isClusterRuntimePlaneActive(clusterId, "diagnostics") && budget.maxConcurrentHeavyChecks > 0
  );
}

export function selectClusterRuntimeState(clusterId: string): Readable<ClusterRuntimeState> {
  return derived([clusterRuntimeContextStore, clusterRuntimeOverridesStore], () =>
    resolveClusterRuntimeState(clusterId),
  );
}
