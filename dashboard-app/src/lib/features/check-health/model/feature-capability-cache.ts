export type FeatureCapabilityStatus =
  | "available"
  | "unsupported"
  | "forbidden"
  | "unreachable"
  | "unavailable"
  | "misconfigured"
  | "disabled"
  | "unknown";

type FeatureCapabilityRecord = {
  status: FeatureCapabilityStatus;
  checkedAt: number;
  reason?: string;
};

const FEATURE_CAPABILITY_TTL_MS = 5 * 60_000;
const featureCapabilityCache = new Map<string, FeatureCapabilityRecord>();

function buildKey(clusterId: string, featureId: string) {
  return `${clusterId}::${featureId}`;
}

function normalizeFeatureCapabilityStatus(reason?: string): FeatureCapabilityStatus {
  if (!reason) return "unknown";
  const normalized = reason.toLowerCase();

  if (
    normalized.includes("doesn't have a resource type") ||
    normalized.includes("no matches for kind") ||
    normalized.includes("not installed") ||
    normalized.includes("the server could not find the requested resource") ||
    normalized.includes("not found")
  ) {
    return "unsupported";
  }
  if (
    normalized.includes("forbidden") ||
    normalized.includes("unauthorized") ||
    normalized.includes("permission")
  ) {
    return "forbidden";
  }
  if (
    normalized.includes("no route to host") ||
    normalized.includes("connection refused") ||
    normalized.includes("failed to connect") ||
    normalized.includes("unable to connect") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("unreachable")
  ) {
    return "unreachable";
  }
  if (
    normalized.includes("serviceunavailable") ||
    normalized.includes("service unavailable") ||
    normalized.includes("metrics api not available") ||
    normalized.includes("no endpoints available")
  ) {
    return "unavailable";
  }
  if (normalized.includes("exit code 127") || normalized.includes("command terminated")) {
    return "misconfigured";
  }
  if (normalized.includes("disabled")) {
    return "disabled";
  }
  return "unknown";
}

export function markFeatureCapability(
  clusterId: string,
  featureId: string,
  options: { status: FeatureCapabilityStatus; reason?: string },
) {
  featureCapabilityCache.set(buildKey(clusterId, featureId), {
    status: options.status,
    checkedAt: Date.now(),
    reason: options.reason,
  });
}

export function markFeatureCapabilityFromReason(
  clusterId: string,
  featureId: string,
  reason?: string,
) {
  markFeatureCapability(clusterId, featureId, {
    status: normalizeFeatureCapabilityStatus(reason),
    reason,
  });
}

export function getFeatureCapability(clusterId: string, featureId: string) {
  const key = buildKey(clusterId, featureId);
  const cached = featureCapabilityCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.checkedAt > FEATURE_CAPABILITY_TTL_MS) {
    featureCapabilityCache.delete(key);
    return null;
  }
  return cached;
}

export function shouldSkipFeatureProbe(
  clusterId: string,
  featureId: string,
  options?: { statuses?: FeatureCapabilityStatus[] },
) {
  const cached = getFeatureCapability(clusterId, featureId);
  if (!cached) return false;
  const statuses = options?.statuses ?? ["unsupported", "forbidden"];
  return statuses.includes(cached.status);
}

export function resetUnreachableEntries() {
  for (const [key, record] of featureCapabilityCache) {
    if (record.status === "unreachable") {
      featureCapabilityCache.delete(key);
    }
  }
}

export function resetFeatureCapabilityCache() {
  featureCapabilityCache.clear();
}
