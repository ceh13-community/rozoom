import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import { createRequestCoalescer } from "$shared/lib/request-coalescer";

export type ClusterVersionInfo = {
  gitVersion: string;
  major: string;
  minor: string;
};

export type ClusterVersionResult = {
  version: ClusterVersionInfo | null;
  errors: string[];
};

const VERSION_CACHE_TTL_MS = 60 * 1000;

const versionRequestCoalescer = createRequestCoalescer();
const versionCache = new Map<string, { fetchedAt: number; result: ClusterVersionResult }>();

function parseClusterVersion(raw: unknown): ClusterVersionInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const root = raw as {
    serverVersion?: { gitVersion?: string; major?: string; minor?: string };
    gitVersion?: string;
    major?: string;
    minor?: string;
  };
  const gitVersion = root.serverVersion?.gitVersion ?? root.gitVersion;
  if (!gitVersion) return null;
  const [parsedMajor = "1", parsedMinor = "0"] = gitVersion.replace(/^v/, "").split(".");
  const major = root.serverVersion?.major ?? root.major ?? parsedMajor;
  const minor = root.serverVersion?.minor ?? root.minor ?? parsedMinor;
  return { gitVersion, major, minor };
}

async function loadClusterVersion(clusterId: string): Promise<ClusterVersionResult> {
  const errors: string[] = [];

  const versionResponse = await kubectlRawArgsFront(["version", "-o", "json"], { clusterId });
  if (!versionResponse.errors) {
    try {
      const version = parseClusterVersion(JSON.parse(versionResponse.output || "{}"));
      if (version) {
        return { version, errors };
      }
      errors.push("Unable to parse server version from kubectl output");
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : "Failed to parse kubectl version output",
      );
    }
  } else {
    errors.push(versionResponse.errors);
  }

  const rawVersionResponse = await kubectlRawArgsFront(["get", "--raw", "/version"], { clusterId });
  if (rawVersionResponse.errors) {
    errors.push(rawVersionResponse.errors);
    return { version: null, errors };
  }

  try {
    return {
      version: parseClusterVersion(JSON.parse(rawVersionResponse.output || "{}")),
      errors,
    };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Failed to parse kubectl /version output");
    return { version: null, errors };
  }
}

export async function fetchClusterVersion(
  clusterId: string,
  options?: { force?: boolean; cacheTtlMs?: number },
): Promise<ClusterVersionResult> {
  const cacheTtlMs = options?.cacheTtlMs ?? VERSION_CACHE_TTL_MS;
  const cached = versionCache.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < cacheTtlMs) {
    return cached.result;
  }

  const result = await versionRequestCoalescer.run(`cluster-version:${clusterId}`, async () => {
    const next = await loadClusterVersion(clusterId);
    versionCache.set(clusterId, { fetchedAt: Date.now(), result: next });
    return next;
  });

  return result;
}

export function resetClusterVersionCache() {
  versionCache.clear();
  versionRequestCoalescer.clear();
}
