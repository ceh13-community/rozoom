import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import type { TriageManifestEntry } from "./triage-manifest";

type TriageDiscoveryRecord = {
  checkedAt: number;
  available: Set<string>;
};

const TRIAGE_DISCOVERY_TTL_MS = 5 * 60_000;
const triageDiscoveryCache = new Map<string, TriageDiscoveryRecord>();

function getCached(clusterId: string) {
  const cached = triageDiscoveryCache.get(clusterId);
  if (!cached) return null;
  if (Date.now() - cached.checkedAt > TRIAGE_DISCOVERY_TTL_MS) {
    triageDiscoveryCache.delete(clusterId);
    return null;
  }
  return cached;
}

function normalizeResourceName(value: string) {
  return value.trim().toLowerCase();
}

function matchesResourceName(candidate: string, resourceName: string) {
  const normalizedCandidate = normalizeResourceName(candidate);
  const normalizedResource = normalizeResourceName(resourceName);
  return (
    normalizedCandidate === normalizedResource ||
    normalizedCandidate.startsWith(`${normalizedResource}.`)
  );
}

async function loadApiResourceNames(clusterId: string) {
  const response = await kubectlRawArgsFront(["api-resources", "--verbs=list", "-o", "name"], {
    clusterId,
  });
  if (response.errors || response.code !== 0) {
    throw new Error(response.errors || "Failed to discover API resources.");
  }
  const available = new Set(
    response.output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => normalizeResourceName(line)),
  );
  triageDiscoveryCache.set(clusterId, {
    checkedAt: Date.now(),
    available,
  });
  return available;
}

export async function discoverTriageResourceSupport(
  clusterId: string,
  manifest: TriageManifestEntry[],
) {
  const cached = getCached(clusterId);
  const available = cached?.available ?? (await loadApiResourceNames(clusterId));

  const supported: TriageManifestEntry[] = [];
  const unsupported: TriageManifestEntry[] = [];

  for (const entry of manifest) {
    if ([...available].some((candidate) => matchesResourceName(candidate, entry.resourceName))) {
      supported.push(entry);
    } else {
      unsupported.push(entry);
    }
  }

  return { supported, unsupported };
}

export function resetTriageDiscoveryCache() {
  triageDiscoveryCache.clear();
}
