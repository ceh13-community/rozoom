import { getClusterNodesNames } from "$shared/api/tauri";
import { error } from "@tauri-apps/plugin-log";
import { resolveCpuRamWithTrace } from "./resolvers/cpu-ram-resolver";
import { resolveDiskWithTrace } from "./resolvers/disk-resolver";
import type { MetricsFlowTrace, MetricsSourceCapability } from "./resolvers/metrics-capabilities";

export interface NodeHealth {
  name: string;
  cpuUsage: string;
  memoryUsage: string;
  diskUsage: string;
}

type CheckNodesHealthOptions = {
  includeDisk?: boolean;
  allowPrometheusFallback?: boolean;
};

export type NodeMetricsDiagnostics = {
  cpuMemory: MetricsFlowTrace;
  disk: MetricsFlowTrace;
  sources: MetricsSourceCapability[];
  checkedAt: string;
};

const DISK_TTL_MS = 120_000;

type DiskCacheEntry = { value: string; ts: number };
const diskCache = new Map<string, DiskCacheEntry>();
const diagnosticsCache = new Map<string, NodeMetricsDiagnostics>();

function diskCacheKey(clusterId: string, nodeName: string) {
  return `${clusterId}::${nodeName}`;
}

function getDiskCached(clusterId: string, nodeName: string): string | undefined {
  const k = diskCacheKey(clusterId, nodeName);
  const entry = diskCache.get(k);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > DISK_TTL_MS) return undefined;
  return entry.value;
}

function setDiskCached(clusterId: string, nodeName: string, value: string) {
  const k = diskCacheKey(clusterId, nodeName);
  diskCache.set(k, { value, ts: Date.now() });
}

async function resolveDisk(
  clusterId: string,
  nodeNames: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing: string[] = [];

  // 0) cache hit or mark missing
  for (const n of nodeNames) {
    const cached = getDiskCached(clusterId, n);
    if (cached !== undefined) out[n] = cached;
    else missing.push(n);
  }

  if (missing.length === 0) return out;

  const resolved = await resolveDiskWithTrace(clusterId, missing);
  for (const [nodeName, value] of Object.entries(resolved.data)) {
    out[nodeName] = value;
    if (value !== "N/A") {
      setDiskCached(clusterId, nodeName, value);
    }
  }

  const previous = diagnosticsCache.get(clusterId);
  diagnosticsCache.set(clusterId, {
    cpuMemory: previous?.cpuMemory ?? {
      metric: "cpu_memory",
      resolvedFrom: null,
      quality: "low",
      attempts: [],
      missingSources: [],
      recommendations: [],
    },
    disk: resolved.trace,
    sources: resolved.capabilities,
    checkedAt: new Date().toISOString(),
  });

  // Ensure all nodes have a value
  for (const n of nodeNames) {
    if (!(n in out)) out[n] = "N/A";
  }

  return out;
}

export function getNodeMetricsDiagnostics(clusterId: string): NodeMetricsDiagnostics | null {
  return diagnosticsCache.get(clusterId) ?? null;
}

export const checkNodesHealth = async (
  clusterId: string,
  nodeName?: string,
  options: CheckNodesHealthOptions = {},
): Promise<NodeHealth | NodeHealth[] | undefined> => {
  try {
    const includeDisk = options.includeDisk !== false;
    const resolvedCpuRam =
      options.allowPrometheusFallback === undefined
        ? await resolveCpuRamWithTrace(clusterId)
        : await resolveCpuRamWithTrace(clusterId, {
            allowPrometheusFallback: options.allowPrometheusFallback,
          });
    const previous = diagnosticsCache.get(clusterId);

    diagnosticsCache.set(clusterId, {
      cpuMemory: resolvedCpuRam.trace,
      disk: previous?.disk ?? {
        metric: "disk",
        resolvedFrom: null,
        quality: "low",
        attempts: [],
        missingSources: [],
        recommendations: [],
      },
      sources: resolvedCpuRam.capabilities,
      checkedAt: new Date().toISOString(),
    });

    const cpuAndMemory = resolvedCpuRam.data;

    if (nodeName) {
      const one = cpuAndMemory.find((n) => n.name === nodeName);
      const diskMap = includeDisk ? await resolveDisk(clusterId, [nodeName]) : {};

      return {
        name: nodeName,
        cpuUsage: one?.cpu ?? "N/A",
        memoryUsage: one?.memory ?? "N/A",
        diskUsage: diskMap[nodeName] ?? "N/A",
      };
    }

    if (cpuAndMemory.length === 0) {
      const nodeNames = await getClusterNodesNames(clusterId);
      if (!nodeNames.length) return [];

      const diskMap = includeDisk ? await resolveDisk(clusterId, nodeNames) : {};

      return nodeNames.map((name) => ({
        name,
        cpuUsage: "N/A",
        memoryUsage: "N/A",
        diskUsage: diskMap[name] ?? "N/A",
      }));
    }

    const nodeNames = cpuAndMemory.map((n) => n.name);
    const diskMap = includeDisk ? await resolveDisk(clusterId, nodeNames) : {};

    return cpuAndMemory.map((n) => ({
      name: n.name,
      cpuUsage: n.cpu,
      memoryUsage: n.memory,
      diskUsage: diskMap[n.name] ?? "N/A",
    }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await error(msg);
    return undefined;
  }
};
