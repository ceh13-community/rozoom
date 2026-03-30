import { setCache, getCache, removeCache } from "$shared/cache";
import { derived, get, writable } from "svelte/store";
import type { ClusterCheckError, ClusterHealthChecks, HealthChecks } from "./types";
import { MAX_HEALTH_CHECK_CACHE_TIME, MAX_HEALTH_CHECKS_PER_CLUSTER } from "$entities/cluster";
import { hasLoadedDiagnosticsScope } from "./diagnostics-scope-state";
import { sanitizeInWorker } from "$shared/lib/cache-worker-proxy";

export const isHealthCheckLoading = writable(false);
export const errors = writable<string | null>(null);
export const clusterHealthChecks = writable<
  Record<string, ClusterHealthChecks | ClusterCheckError | null>
>({});

const clusterHealthCheckSelectors = new Map<
  string,
  ReturnType<
    typeof derived<typeof clusterHealthChecks, ClusterHealthChecks | ClusterCheckError | null>
  >
>();

export function selectClusterHealthCheck(clusterId: string) {
  let selector = clusterHealthCheckSelectors.get(clusterId);
  if (!selector) {
    selector = derived(clusterHealthChecks, ($checks) => $checks[clusterId] ?? null);
    clusterHealthCheckSelectors.set(clusterId, selector);
  }
  return selector;
}

/** Remove cached derived selectors for clusters no longer on the dashboard. */
export function pruneHealthCheckSelectors(activeClusterIds: Set<string>) {
  for (const id of clusterHealthCheckSelectors.keys()) {
    if (!activeClusterIds.has(id)) {
      clusterHealthCheckSelectors.delete(id);
    }
  }
}

/** Remove health check data for clusters no longer managed. */
export function pruneHealthCheckData(activeClusterIds: Set<string>) {
  clusterHealthChecks.update((checks) => {
    let changed = false;
    for (const id of Object.keys(checks)) {
      if (!activeClusterIds.has(id)) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- hot path, avoid copying
        delete checks[id];
        changed = true;
      }
    }
    return changed ? { ...checks } : checks;
  });
}

export function isClusterHealthCheckHydrated(clusterId: string): boolean {
  return clusterId in get(clusterHealthChecks);
}

function sanitizeCacheValue(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (value instanceof Set) {
    return Array.from(value).map((entry) => sanitizeCacheValue(entry, seen));
  }

  if (value instanceof Map) {
    return Object.fromEntries(
      Array.from(value.entries(), ([key, entry]) => [String(key), sanitizeCacheValue(entry, seen)]),
    );
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeCacheValue(entry, seen));
  }

  if (value && typeof value === "object") {
    const cached = seen.get(value);
    if (cached) {
      return cached;
    }

    const next: Record<string, unknown> = {};
    seen.set(value, next);

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      next[key] = sanitizeCacheValue(entry, seen);
    }

    return next;
  }

  return value;
}

export function sanitizeHealthChecksCache(
  data: HealthChecks | null | undefined,
): HealthChecks | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  return sanitizeCacheValue(data) as HealthChecks;
}

function isPoisonedHealthChecksCacheError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes("set@[native code]") || normalized.includes("type error");
}

export async function recoverHealthChecksCache(error: unknown) {
  if (!isPoisonedHealthChecksCacheError(error)) return false;
  try {
    await removeCache("health_checks");
    return true;
  } catch {
    return false;
  }
}

type ConfigDiagnosticsField =
  | "resourcesHygiene"
  | "hpaStatus"
  | "probesHealth"
  | "podQos"
  | "vpaStatus"
  | "topologyHa"
  | "pdbStatus"
  | "priorityStatus"
  | "podSecurity"
  | "networkIsolation"
  | "secretsHygiene"
  | "securityHardening";

type HealthDiagnosticsField =
  | "apiServerHealth"
  | "apiServerLatency"
  | "certificatesHealth"
  | "podIssues"
  | "admissionWebhooks"
  | "warningEvents"
  | "blackboxProbes"
  | "apfHealth"
  | "etcdHealth";

const CONFIG_DIAGNOSTICS_FIELDS: ConfigDiagnosticsField[] = [
  "resourcesHygiene",
  "hpaStatus",
  "probesHealth",
  "podQos",
  "vpaStatus",
  "topologyHa",
  "pdbStatus",
  "priorityStatus",
  "podSecurity",
  "networkIsolation",
  "secretsHygiene",
  "securityHardening",
];

const HEALTH_DIAGNOSTICS_FIELDS: HealthDiagnosticsField[] = [
  "apiServerHealth",
  "apiServerLatency",
  "certificatesHealth",
  "podIssues",
  "admissionWebhooks",
  "warningEvents",
  "blackboxProbes",
  "apfHealth",
  "etcdHealth",
];

function getMostRecentCheck(
  checks: Array<ClusterHealthChecks | ClusterCheckError>,
): ClusterHealthChecks | ClusterCheckError {
  let mostRecentCheck = checks[0];
  for (const check of checks) {
    if (check.timestamp > mostRecentCheck.timestamp) {
      mostRecentCheck = check;
    }
  }
  return mostRecentCheck;
}

function getMostRecentSuccessfulCheckWithScope(
  checks: Array<ClusterHealthChecks | ClusterCheckError>,
  scope: "config" | "health",
): ClusterHealthChecks | null {
  let candidate: ClusterHealthChecks | null = null;
  for (const check of checks) {
    if ("errors" in check && check.errors) continue;
    if (!hasLoadedDiagnosticsScope(check as ClusterHealthChecks, scope)) continue;
    if (!candidate || check.timestamp > candidate.timestamp) {
      candidate = check as ClusterHealthChecks;
    }
  }
  return candidate;
}

function mergeFields(
  target: ClusterHealthChecks,
  source: ClusterHealthChecks,
  fields: ReadonlyArray<ConfigDiagnosticsField | HealthDiagnosticsField>,
) {
  const mutableTarget = target as Record<string, unknown>;
  const sourceRecord = source as Record<string, unknown>;
  for (const field of fields) {
    if (mutableTarget[field] == null) {
      mutableTarget[field] = sourceRecord[field];
    }
  }
}

function mergeDiagnosticsScope(
  target: ClusterHealthChecks,
  source: ClusterHealthChecks,
  scope: "config" | "health",
) {
  mergeFields(
    target,
    source,
    scope === "config" ? CONFIG_DIAGNOSTICS_FIELDS : HEALTH_DIAGNOSTICS_FIELDS,
  );

  target.diagnosticsSnapshots = {
    configLoadedAt:
      scope === "config"
        ? source.diagnosticsSnapshots?.configLoadedAt
        : target.diagnosticsSnapshots?.configLoadedAt,
    healthLoadedAt:
      scope === "health"
        ? source.diagnosticsSnapshots?.healthLoadedAt
        : target.diagnosticsSnapshots?.healthLoadedAt,
  };
}

export function selectPreferredClusterCheck(
  checks: Array<ClusterHealthChecks | ClusterCheckError> | null | undefined,
): ClusterHealthChecks | ClusterCheckError | null {
  if (!Array.isArray(checks) || checks.length === 0) {
    return null;
  }

  const mostRecentCheck = getMostRecentCheck(checks);
  if ("errors" in mostRecentCheck && mostRecentCheck.errors) {
    return mostRecentCheck;
  }

  const mergedCheck = sanitizeCacheValue(mostRecentCheck) as ClusterHealthChecks;
  if (!hasLoadedDiagnosticsScope(mergedCheck, "config")) {
    const configSource = getMostRecentSuccessfulCheckWithScope(checks, "config");
    if (configSource) {
      mergeDiagnosticsScope(mergedCheck, configSource, "config");
    }
  }
  if (!hasLoadedDiagnosticsScope(mergedCheck, "health")) {
    const healthSource = getMostRecentSuccessfulCheckWithScope(checks, "health");
    if (healthSource) {
      mergeDiagnosticsScope(mergedCheck, healthSource, "health");
    }
  }

  return mergedCheck;
}

function clusterCacheKey(clusterId: string): string {
  return `health_checks:${clusterId}`;
}

export async function getClusterCacheChecks(
  clusterId: string,
): Promise<Array<ClusterHealthChecks | ClusterCheckError>> {
  try {
    const sharded = await getCache<Array<ClusterHealthChecks | ClusterCheckError>>(
      clusterCacheKey(clusterId),
    );
    if (Array.isArray(sharded) && sharded.length > 0) return sharded;
  } catch {
    // fall through to legacy
  }
  try {
    const legacy = sanitizeHealthChecksCache(await getCache("health_checks"));
    return legacy?.[clusterId] ?? [];
  } catch (error) {
    await recoverHealthChecksCache(error);
    return [];
  }
}

export const setClusterCheck = async (
  clusterId: string,
  data: ClusterHealthChecks | ClusterCheckError,
  options: { persistToCache?: boolean } = {},
) => {
  isHealthCheckLoading.set(true);
  errors.set(null);

  // Sanitize only for cache persistence, not for in-memory store.
  // Deep-cloning on every update was the #1 memory allocation hotspot.
  clusterHealthChecks.update((checks) => {
    const existing = checks[clusterId];
    if (existing && !("errors" in existing) && !("errors" in data)) {
      const merged = existing as Record<string, unknown>;
      const entries = data as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(entries)) {
        if (value != null) {
          merged[key] = value;
        }
      }
      const existingSnaps = existing.diagnosticsSnapshots;
      const incomingSnaps = data.diagnosticsSnapshots;
      existing.diagnosticsSnapshots = {
        configLoadedAt: incomingSnaps?.configLoadedAt ?? existingSnaps?.configLoadedAt,
        healthLoadedAt: incomingSnaps?.healthLoadedAt ?? existingSnaps?.healthLoadedAt,
      };
      return { ...checks, [clusterId]: { ...existing } };
    }
    return { ...checks, [clusterId]: data };
  });

  if (data.errors) errors.set(data.errors);

  if (options.persistToCache === false) {
    isHealthCheckLoading.set(false);
    return;
  }

  const now = Date.now();
  const cutoffTime = now - MAX_HEALTH_CHECK_CACHE_TIME * 1000;

  const existingChecks = await getClusterCacheChecks(clusterId);

  const recentChecks = existingChecks.filter((check) => {
    const checkTime = check.timestamp || 0;
    return checkTime > cutoffTime;
  });

  const sanitizedData = sanitizeCacheValue(data) as ClusterHealthChecks | ClusterCheckError;
  const updatedChecks = [sanitizedData, ...recentChecks];
  const limitedChecks = updatedChecks.slice(0, MAX_HEALTH_CHECKS_PER_CLUSTER);

  const sanitized =
    await sanitizeInWorker<Array<ClusterHealthChecks | ClusterCheckError>>(limitedChecks);
  await setCache(clusterCacheKey(clusterId), sanitized);

  isHealthCheckLoading.set(false);
};

export const loadHealthChecks = async () => {
  isHealthCheckLoading.set(true);

  try {
    const data = sanitizeHealthChecksCache(await getCache("health_checks"));

    return data as HealthChecks;
  } catch (err) {
    await recoverHealthChecksCache(err);
    errors.set(err instanceof Error ? err.message : "Unknown error");
    return null;
  } finally {
    isHealthCheckLoading.set(false);
  }
};

export const hydrateLatestHealthChecks = async (clusterIds?: string[]) => {
  isHealthCheckLoading.set(true);
  errors.set(null);

  try {
    const allowedClusterIds = Array.isArray(clusterIds) ? clusterIds : [];
    const hydratedChecks: Record<string, ClusterHealthChecks | ClusterCheckError | null> = {};

    const results = await Promise.all(
      allowedClusterIds.map(async (clusterId) => {
        const checks = await getClusterCacheChecks(clusterId);
        return { clusterId, checks };
      }),
    );

    for (const { clusterId, checks } of results) {
      const preferredCheck = selectPreferredClusterCheck(checks);
      hydratedChecks[clusterId] = preferredCheck ?? null;
    }

    clusterHealthChecks.update((checks) => ({
      ...checks,
      ...hydratedChecks,
    }));

    return hydratedChecks;
  } catch (err) {
    await recoverHealthChecksCache(err);
    errors.set(err instanceof Error ? err.message : "Unknown error");
    return null;
  } finally {
    isHealthCheckLoading.set(false);
  }
};

export const getLastHealthCheck = async (clusterId: string) => {
  if (!clusterId) {
    clusterHealthChecks.update((checks) => ({
      ...checks,
      [clusterId]: null,
    }));
    return null;
  }

  isHealthCheckLoading.set(true);
  errors.set(null);

  try {
    const checks = await getClusterCacheChecks(clusterId);

    const preferredCheck = selectPreferredClusterCheck(checks);
    if (!preferredCheck) {
      clusterHealthChecks.update((checks) => ({
        ...checks,
        [clusterId]: null,
      }));
      return null;
    }
    clusterHealthChecks.update((checks) => ({
      ...checks,
      [clusterId]: preferredCheck,
    }));
    isHealthCheckLoading.set(false);

    return preferredCheck;
  } catch (err) {
    await recoverHealthChecksCache(err);
    errors.set(err instanceof Error ? err.message : "Unknown error");
    const errorCheck = {
      errors: err instanceof Error ? err.message : "",
      timestamp: Date.now(),
    };

    clusterHealthChecks.update((checks) => ({
      ...checks,
      [clusterId]: errorCheck,
    }));
    isHealthCheckLoading.set(false);
    return null;
  }
};

export const updateClusterCheckPartially = async (
  clusterId: string,
  partialData: Partial<ClusterHealthChecks> & { errors?: string },
) => {
  if (!clusterId) return;

  isHealthCheckLoading.set(true);
  errors.set(null);

  try {
    const existingChecksForCluster = await getClusterCacheChecks(clusterId);

    let baseCheck: ClusterHealthChecks | null = null;

    for (let i = 0; i < existingChecksForCluster.length; i++) {
      const check = existingChecksForCluster[i];
      if ("timestamp" in check && !("errors" in check || check.errors)) {
        baseCheck = check;
        break;
      }
    }

    if (!baseCheck) {
      baseCheck = {
        daemonSets: 0,
        deployments: 0,
        jobs: 0,
        replicaSets: 0,
        pods: 0,
        statefulSets: 0,
        namespaces: [],
        podRestarts: [],
        cronJobs: 0,
        cronJobsHealth: {
          items: [],
          summary: {
            total: 0,
            ok: 0,
            warning: 0,
            critical: 0,
            unknown: 0,
          },
          updatedAt: Date.now(),
        },
        apiServerHealth: {
          live: { ok: false, output: "", error: "Unreachable" },
          ready: { ok: false, output: "", error: "Unreachable" },
          status: "unknown",
          updatedAt: Date.now(),
        },
        apiServerLatency: {
          status: "unknown",
          summary: { status: "unknown", warnings: [], updatedAt: Date.now() },
          overall: {},
          groups: [],
          updatedAt: Date.now(),
        },
        certificatesHealth: {
          status: "unknown",
          summary: { status: "unknown", warnings: [], updatedAt: Date.now() },
          certificates: [],
          kubeletRotation: [],
          updatedAt: Date.now(),
        },
        podIssues: {
          status: "unknown",
          summary: { status: "unknown", warnings: [], updatedAt: Date.now() },
          items: [],
          totalPods: 0,
          crashLoopCount: 0,
          pendingCount: 0,
          updatedAt: Date.now(),
        },
        admissionWebhooks: {
          status: "unknown",
          summary: { status: "unknown", warnings: [], updatedAt: Date.now() },
          items: [],
          totals: {},
          updatedAt: Date.now(),
        },
        warningEvents: {
          status: "unknown",
          summary: { status: "unknown", warnings: [], updatedAt: Date.now() },
          items: [],
          updatedAt: Date.now(),
        },
        blackboxProbes: {
          status: "unknown",
          summary: { status: "unknown", warnings: [], updatedAt: Date.now() },
          items: [],
          updatedAt: Date.now(),
        },
        apfHealth: {
          status: "unknown",
          summary: { status: "unknown", warnings: [], updatedAt: Date.now() },
          metrics: null,
          metricRates: {},
          updatedAt: Date.now(),
        },
        etcdHealth: {
          status: "unknown",
          summary: { status: "unknown", warnings: [], updatedAt: Date.now() },
          health: [],
          endpointStatus: [],
          metrics: [],
          metricRates: {},
          updatedAt: Date.now(),
        },
        resourcesHygiene: {
          status: "unknown",
          summary: {
            status: "unknown",
            message: "Unknown",
            total: 0,
            ok: 0,
            warning: 0,
            critical: 0,
            bestEffort: 0,
            updatedAt: Date.now(),
          },
          workloads: [],
          items: [],
          updatedAt: Date.now(),
        },
        hpaStatus: {
          status: "unknown",
          summary: {
            status: "unknown",
            message: "Unknown",
            total: 0,
            ok: 0,
            warning: 0,
            critical: 0,
            updatedAt: Date.now(),
          },
          items: [],
          updatedAt: Date.now(),
        },
        probesHealth: {
          status: "unknown",
          summary: {
            status: "unknown",
            message: "Unknown",
            total: 0,
            ok: 0,
            warning: 0,
            critical: 0,
            updatedAt: Date.now(),
          },
          workloads: [],
          items: [],
          updatedAt: Date.now(),
        },
        podQos: {
          status: "unknown",
          summary: {
            status: "unknown",
            message: "Unknown",
            total: 0,
            ok: 0,
            warning: 0,
            critical: 0,
            bestEffort: 0,
            updatedAt: Date.now(),
          },
          items: [],
          updatedAt: Date.now(),
        },
        vpaStatus: {
          status: "unknown",
          summary: {
            status: "unknown",
            message: "Unknown",
            total: 0,
            ok: 0,
            warning: 0,
            critical: 0,
            updatedAt: Date.now(),
          },
          items: [],
          updatedAt: Date.now(),
        },
        topologyHa: {
          status: "unknown",
          summary: {
            status: "unknown",
            message: "Unknown",
            total: 0,
            ok: 0,
            warning: 0,
            critical: 0,
            updatedAt: Date.now(),
          },
          items: [],
          updatedAt: Date.now(),
        },
        pdbStatus: {
          status: "unknown",
          summary: {
            status: "unknown",
            message: "Unknown",
            total: 0,
            ok: 0,
            warning: 0,
            critical: 0,
            updatedAt: Date.now(),
          },
          items: [],
          updatedAt: Date.now(),
        },
        priorityStatus: {
          status: "unknown",
          summary: {
            status: "unknown",
            message: "Unknown",
            total: 0,
            ok: 0,
            warning: 0,
            critical: 0,
            updatedAt: Date.now(),
          },
          items: [],
          updatedAt: Date.now(),
        },
        podSecurity: {
          status: "unknown",
          summary: {
            status: "unknown",
            message: "Unknown",
            total: 0,
            ok: 0,
            warning: 0,
            critical: 0,
            updatedAt: Date.now(),
          },
          namespaces: [],
          items: [],
          updatedAt: Date.now(),
        },
        networkIsolation: {
          status: "unknown",
          summary: {
            status: "unknown",
            message: "Unknown",
            total: 0,
            ok: 0,
            warning: 0,
            critical: 0,
            updatedAt: Date.now(),
          },
          items: [],
          updatedAt: Date.now(),
        },
        secretsHygiene: {
          status: "unknown",
          summary: {
            status: "unknown",
            message: "Unknown",
            total: 0,
            ok: 0,
            warning: 0,
            critical: 0,
            updatedAt: Date.now(),
          },
          items: [],
          encryptionStatus: "unknown",
          updatedAt: Date.now(),
        },
        securityHardening: {
          status: "unknown",
          summary: {
            status: "unknown",
            message: "Unknown",
            total: 0,
            ok: 0,
            warning: 0,
            critical: 0,
            updatedAt: Date.now(),
          },
          items: [],
          updatedAt: Date.now(),
        },
        nodes: null,
        metricsChecks: { endpoints: {} },
        timestamp: Date.now(),
      };
    }

    const updatedCheck: ClusterHealthChecks = {
      ...baseCheck,
      ...partialData,
      timestamp: Date.now(),
      errors: partialData.errors ?? undefined,
    };

    await setClusterCheck(clusterId, updatedCheck);
  } catch (err) {
    await recoverHealthChecksCache(err);
    const errorMsg = err instanceof Error ? err.message : "Unknown error during partial update";
    errors.set(errorMsg);

    const errorCheck: ClusterCheckError = {
      errors: errorMsg,
      timestamp: Date.now(),
    };

    await setClusterCheck(clusterId, errorCheck);
  } finally {
    isHealthCheckLoading.set(false);
  }
};
