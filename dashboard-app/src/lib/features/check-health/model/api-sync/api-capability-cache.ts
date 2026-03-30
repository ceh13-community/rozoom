type CapabilityStatus = "available" | "unsupported" | "forbidden" | "unreachable" | "unknown";

type CapabilityRecord = {
  status: CapabilityStatus;
  checkedAt: number;
  reason?: string;
};

const CAPABILITY_TTL_MS = 5 * 60_000;

const capabilityCache = new Map<string, CapabilityRecord>();

function buildKey(clusterId: string, path: string) {
  return `${clusterId}::${path}`;
}

function normalizeCapabilityStatus(reason?: string): CapabilityStatus {
  if (!reason) return "unknown";
  const normalized = reason.toLowerCase();

  if (
    normalized.includes("doesn't have a resource type") ||
    normalized.includes("no matches for kind") ||
    normalized.includes("not found") ||
    normalized.includes("the server could not find the requested resource")
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
    normalized.includes("unable to connect") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("unreachable")
  ) {
    return "unreachable";
  }
  return "unknown";
}

export function markApiPathCapability(
  clusterId: string,
  path: string,
  options: { status: CapabilityStatus; reason?: string },
) {
  capabilityCache.set(buildKey(clusterId, path), {
    status: options.status,
    checkedAt: Date.now(),
    reason: options.reason,
  });
}

export function markApiPathCapabilityFromError(clusterId: string, path: string, error: unknown) {
  const reason = error instanceof Error ? error.message : String(error);
  markApiPathCapability(clusterId, path, {
    status: normalizeCapabilityStatus(reason),
    reason,
  });
}

export function getApiPathCapability(clusterId: string, path: string) {
  const cached = capabilityCache.get(buildKey(clusterId, path));
  if (!cached) return null;
  if (Date.now() - cached.checkedAt > CAPABILITY_TTL_MS) {
    capabilityCache.delete(buildKey(clusterId, path));
    return null;
  }
  return cached;
}

export function shouldSkipApiPath(clusterId: string, path: string) {
  const cached = getApiPathCapability(clusterId, path);
  if (!cached) return false;
  return cached.status === "unsupported" || cached.status === "forbidden";
}

export function resetApiCapabilityCache() {
  capabilityCache.clear();
}
