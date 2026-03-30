import type { PageData } from "$entities/cluster";
import type {
  CertificateItem,
  ClusterHealthChecks,
  KubeletRotationItem,
  WarningEventItem,
} from "$features/check-health/model/types";
import type { OverviewAccessProfile } from "./overview-access";
import type { OverviewHealthHistoryEntry } from "./overview-diagnostics";

export type EventRow = {
  uid: string;
  reason: string;
  object: string;
  message: string;
  name: string;
  date: string;
};

export type CertificateRow = {
  uid: string;
  name: string;
  expiresIn: string;
  expiresOn: string;
  status: string;
};

export type RotationRow = {
  uid: string;
  node: string;
  rotateClient: string;
  rotateServer: string;
  status: string;
  message: string;
};

export type OverviewSnapshot = {
  schemaVersion: 1;
  scopeKey: string;
  cachedAt: number;
  eventsHydrated: boolean;
  certificatesHydrated: boolean;
  lastEventsSuccessAt: number;
  lastCertificatesSuccessAt: number;
  eventsRows: EventRow[];
  certificatesRows: CertificateRow[];
  rotationRows: RotationRow[];
  warningItems: WarningEventItem[];
  eventsError: string | null;
  certificatesError: string | null;
  clusterHealth: ClusterHealthChecks | null;
  clusterHealthError: string | null;
  usageMetricsError: string | null;
  cpuAveragePercent: number | null;
  memoryAveragePercent: number | null;
  cpuReservedCores: number | null;
  memoryReservedBytes: number | null;
  coreMetricsUnavailable: boolean | null;
  podCapacity: number | null;
  providerIds: string[];
  usageMetricsLastLoadedAt: number;
  accessProfile: OverviewAccessProfile | null;
  accessProfileError: string | null;
};

type ScopeData = PageData & {
  namespace?: string | null;
  filtersKey?: string | null;
};

type SnapshotStorageConfig = {
  storagePrefix: string;
  ttlMs: number;
  maxEntries: number;
};

type HistoryStorageConfig = SnapshotStorageConfig;

export type OverviewHealthHistory = {
  schemaVersion: 1;
  scopeKey: string;
  entries: OverviewHealthHistoryEntry[];
};

function normalizeScopeSegment(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export function createOverviewScopeKey(data: ScopeData | null | undefined) {
  const clusterId = normalizeScopeSegment(data?.slug, "unknown-cluster");
  const workload = normalizeScopeSegment(data?.workload, "overview");
  const namespace = normalizeScopeSegment(data?.namespace, "all");
  const sortField = normalizeScopeSegment(data?.sort_field, "name");
  const filtersKey = normalizeScopeSegment(data?.filtersKey, "none");
  return [clusterId, workload, namespace, sortField, filtersKey].join("::");
}

export function getOverviewSnapshotStorageKey(storagePrefix: string, scopeKey: string) {
  return `${storagePrefix}:${encodeURIComponent(scopeKey)}`;
}

export function getOverviewHistoryStorageKey(storagePrefix: string, scopeKey: string) {
  return `${storagePrefix}:${encodeURIComponent(scopeKey)}`;
}

export function getOverviewSyncSettingsKey(settingsPrefix: string, scopeKey: string) {
  return `${settingsPrefix}:${encodeURIComponent(scopeKey)}`;
}

export function formatEvent(item: WarningEventItem): EventRow {
  const date = new Date(item.timestamp).toLocaleString();
  const object = `${item.objectKind} ${item.namespace}/${item.objectName}`;
  return {
    uid: `${item.timestamp}-${item.namespace}-${item.objectName}-${item.reason}-${item.count}-${item.message.slice(0, 32)}`,
    reason: item.reason,
    object,
    message: item.message,
    name: item.objectName,
    date,
  };
}

export function formatCertificate(item: CertificateItem): CertificateRow {
  const expiresIn = item.daysLeft != null ? `${item.daysLeft} days` : (item.residual ?? "-");
  return {
    uid: item.name,
    name: item.name,
    expiresIn,
    expiresOn: item.expiresAt ?? "-",
    status: item.status,
  };
}

export function formatRotation(item: KubeletRotationItem): RotationRow {
  const clientStatus =
    item.rotateClient === undefined ? "Unknown" : item.rotateClient ? "Enabled" : "Disabled";
  const serverStatus =
    item.rotateServer === undefined ? "Unknown" : item.rotateServer ? "Enabled" : "Disabled";
  return {
    uid: item.node,
    node: item.node,
    rotateClient: clientStatus,
    rotateServer: serverStatus,
    status: item.status,
    message: item.message ?? "-",
  };
}

export function normalizePercentValue(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

export function formatRelativeTime(timestamp: number | null) {
  if (!timestamp) return null;
  const ageMs = Math.max(0, Date.now() - timestamp);
  const ageSec = Math.floor(ageMs / 1000);
  if (ageSec <= 0) return "just now";
  if (ageSec < 60) return `${ageSec}s ago`;
  const ageMin = Math.floor(ageSec / 60);
  if (ageMin < 60) return `${ageMin}m ago`;
  const ageHours = Math.floor(ageMin / 60);
  if (ageHours < 24) return `${ageHours}h ago`;
  const ageDays = Math.floor(ageHours / 24);
  return `${ageDays}d ago`;
}

export function shouldKeepStaleSection(
  lastSuccessAt: number,
  rowsCount: number,
  staleTtlMs: number,
) {
  if (rowsCount <= 0) return false;
  if (lastSuccessAt <= 0) return false;
  return Date.now() - lastSuccessAt <= staleTtlMs;
}

export function captureOverviewSnapshot(
  scopeKey: string,
  state: Omit<OverviewSnapshot, "schemaVersion" | "scopeKey" | "cachedAt">,
): OverviewSnapshot {
  return {
    schemaVersion: 1,
    scopeKey,
    cachedAt: Date.now(),
    ...state,
  };
}

export function parseOverviewSnapshot(raw: string | null, ttlMs: number): OverviewSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OverviewSnapshot>;
    if (parsed.schemaVersion !== 1) return null;
    if (typeof parsed.scopeKey !== "string" || parsed.scopeKey.length === 0) return null;
    if (!Number.isFinite(parsed.cachedAt)) return null;
    if (Date.now() - Number(parsed.cachedAt) > ttlMs) return null;
    if (!Array.isArray(parsed.eventsRows)) return null;
    if (!Array.isArray(parsed.certificatesRows)) return null;
    if (!Array.isArray(parsed.rotationRows)) return null;
    if (!Array.isArray(parsed.warningItems)) return null;
    if (!Array.isArray(parsed.providerIds)) return null;
    return {
      schemaVersion: 1,
      scopeKey: parsed.scopeKey,
      cachedAt: Number(parsed.cachedAt),
      eventsHydrated: typeof parsed.eventsHydrated === "boolean" ? parsed.eventsHydrated : false,
      certificatesHydrated:
        typeof parsed.certificatesHydrated === "boolean" ? parsed.certificatesHydrated : false,
      lastEventsSuccessAt:
        typeof parsed.lastEventsSuccessAt === "number" ? parsed.lastEventsSuccessAt : 0,
      lastCertificatesSuccessAt:
        typeof parsed.lastCertificatesSuccessAt === "number" ? parsed.lastCertificatesSuccessAt : 0,
      eventsRows: parsed.eventsRows,
      certificatesRows: parsed.certificatesRows,
      rotationRows: parsed.rotationRows,
      warningItems: parsed.warningItems,
      eventsError: typeof parsed.eventsError === "string" ? parsed.eventsError : null,
      certificatesError:
        typeof parsed.certificatesError === "string" ? parsed.certificatesError : null,
      clusterHealth: (parsed.clusterHealth as ClusterHealthChecks | null) ?? null,
      clusterHealthError:
        typeof parsed.clusterHealthError === "string" ? parsed.clusterHealthError : null,
      usageMetricsError:
        typeof parsed.usageMetricsError === "string" ? parsed.usageMetricsError : null,
      cpuAveragePercent:
        typeof parsed.cpuAveragePercent === "number"
          ? normalizePercentValue(parsed.cpuAveragePercent)
          : null,
      memoryAveragePercent:
        typeof parsed.memoryAveragePercent === "number"
          ? normalizePercentValue(parsed.memoryAveragePercent)
          : null,
      cpuReservedCores:
        typeof parsed.cpuReservedCores === "number" ? parsed.cpuReservedCores : null,
      memoryReservedBytes:
        typeof parsed.memoryReservedBytes === "number" ? parsed.memoryReservedBytes : null,
      coreMetricsUnavailable:
        typeof parsed.coreMetricsUnavailable === "boolean" ? parsed.coreMetricsUnavailable : null,
      podCapacity: typeof parsed.podCapacity === "number" ? parsed.podCapacity : null,
      providerIds: parsed.providerIds.filter((value): value is string => typeof value === "string"),
      usageMetricsLastLoadedAt:
        typeof parsed.usageMetricsLastLoadedAt === "number" ? parsed.usageMetricsLastLoadedAt : 0,
      accessProfile: (parsed.accessProfile as OverviewAccessProfile | null) ?? null,
      accessProfileError:
        typeof parsed.accessProfileError === "string" ? parsed.accessProfileError : null,
    };
  } catch {
    return null;
  }
}

export function loadOverviewSnapshot(
  scopeKey: string,
  memory: Map<string, OverviewSnapshot>,
  config: SnapshotStorageConfig,
): OverviewSnapshot | null {
  const inMemory = memory.get(scopeKey);
  if (inMemory && Date.now() - inMemory.cachedAt <= config.ttlMs) {
    return inMemory;
  }
  if (typeof window === "undefined") return null;
  try {
    const parsed = parseOverviewSnapshot(
      window.localStorage.getItem(getOverviewSnapshotStorageKey(config.storagePrefix, scopeKey)),
      config.ttlMs,
    );
    if (parsed && parsed.scopeKey === scopeKey) {
      memory.set(scopeKey, parsed);
    }
    return parsed && parsed.scopeKey === scopeKey ? parsed : null;
  } catch {
    return null;
  }
}

export function cleanupOverviewSnapshotStorage(config: SnapshotStorageConfig) {
  if (typeof window === "undefined") return;
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key) continue;
    if (key.startsWith(`${config.storagePrefix}:`)) {
      keys.push(key);
    }
  }
  if (keys.length === 0) return;

  const entries: Array<{ key: string; cachedAt: number }> = [];
  for (const key of keys) {
    const parsed = parseOverviewSnapshot(window.localStorage.getItem(key), config.ttlMs);
    if (!parsed) {
      window.localStorage.removeItem(key);
      continue;
    }
    entries.push({ key, cachedAt: parsed.cachedAt });
  }

  if (entries.length <= config.maxEntries) return;
  entries.sort((left, right) => right.cachedAt - left.cachedAt);
  for (const stale of entries.slice(config.maxEntries)) {
    window.localStorage.removeItem(stale.key);
  }
}

export function persistOverviewSnapshot(
  scopeKey: string,
  snapshot: OverviewSnapshot,
  memory: Map<string, OverviewSnapshot>,
  config: SnapshotStorageConfig,
) {
  if (!scopeKey) return;
  memory.set(scopeKey, snapshot);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      getOverviewSnapshotStorageKey(config.storagePrefix, scopeKey),
      JSON.stringify(snapshot),
    );
    cleanupOverviewSnapshotStorage(config);
  } catch {
    // ignore storage errors
  }
}

export function parseOverviewHistory(
  raw: string | null,
  ttlMs: number,
  maxEntries: number,
): OverviewHealthHistory | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OverviewHealthHistory>;
    if (parsed.schemaVersion !== 1) return null;
    if (typeof parsed.scopeKey !== "string" || parsed.scopeKey.length === 0) return null;
    if (!Array.isArray(parsed.entries)) return null;
    const entries = parsed.entries
      .filter(
        (entry) => Number.isFinite(entry.capturedAt) && Date.now() - entry.capturedAt <= ttlMs,
      )
      .sort((left, right) => left.capturedAt - right.capturedAt)
      .slice(-maxEntries);
    return {
      schemaVersion: 1,
      scopeKey: parsed.scopeKey,
      entries,
    };
  } catch {
    return null;
  }
}

export function loadOverviewHistory(
  scopeKey: string,
  memory: Map<string, OverviewHealthHistory>,
  config: HistoryStorageConfig,
): OverviewHealthHistoryEntry[] {
  const inMemory = memory.get(scopeKey);
  if (inMemory) return inMemory.entries;
  if (typeof window === "undefined") return [];
  try {
    const parsed = parseOverviewHistory(
      window.localStorage.getItem(getOverviewHistoryStorageKey(config.storagePrefix, scopeKey)),
      config.ttlMs,
      config.maxEntries,
    );
    if (parsed && parsed.scopeKey === scopeKey) {
      memory.set(scopeKey, parsed);
      return parsed.entries;
    }
  } catch {
    // ignore storage errors
  }
  return [];
}

export function persistOverviewHistory(
  scopeKey: string,
  entry: OverviewHealthHistoryEntry,
  memory: Map<string, OverviewHealthHistory>,
  config: HistoryStorageConfig,
) {
  if (!scopeKey) return;
  const current = memory.get(scopeKey)?.entries ?? [];
  const entries = [...current, entry]
    .filter(
      (item, index, all) =>
        index === all.findIndex((candidate) => candidate.capturedAt === item.capturedAt),
    )
    .filter((item) => Date.now() - item.capturedAt <= config.ttlMs)
    .sort((left, right) => left.capturedAt - right.capturedAt)
    .slice(-config.maxEntries);
  const payload: OverviewHealthHistory = {
    schemaVersion: 1,
    scopeKey,
    entries,
  };
  memory.set(scopeKey, payload);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      getOverviewHistoryStorageKey(config.storagePrefix, scopeKey),
      JSON.stringify(payload),
    );
  } catch {
    // ignore storage errors
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${label} timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeoutId);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
