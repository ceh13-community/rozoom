import { getNodeAvailableDiskSpace } from "../node-disk-space";
import { diskFromKubeletSummary, diskFromPrometheus } from "../metrics-resolvers";
import {
  buildRecommendations,
  getMetricsSourceCapabilities,
  getMissingSourceIds,
  type MetricsFlowTrace,
  type MetricsSourceAttempt,
  type MetricsSourceCapability,
} from "./metrics-capabilities";

function formatGiB(value: number): string {
  return `${value.toFixed(2)} GiB`;
}

function sourceAvailable(
  capabilities: MetricsSourceCapability[],
  id: MetricsSourceAttempt["source"],
): boolean {
  const source = capabilities.find((entry) => entry.id === id);
  return Boolean(source?.available);
}

function qualityFromSource(source: MetricsFlowTrace["resolvedFrom"]): MetricsFlowTrace["quality"] {
  if (source === "api" || source === "node_exporter") return "high";
  if (source === "prometheus" || source === "metrics_server") return "medium";
  return "low";
}

function normalizeToArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

const NODE_EXPORTER_DISK_CONCURRENCY = 4;

async function forEachWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async (_, workerId) => {
      for (let i = workerId; i < items.length; i += concurrency) {
        await worker(items[i]);
      }
    },
  );
  await Promise.all(workers);
}

export async function resolveDiskWithTrace(
  clusterId: string,
  nodeNames: string[],
): Promise<{
  data: Record<string, string>;
  trace: MetricsFlowTrace;
  capabilities: MetricsSourceCapability[];
}> {
  const out: Record<string, string> = {};
  const attempts: MetricsSourceAttempt[] = [];
  const capabilities = await getMetricsSourceCapabilities(clusterId);

  if (nodeNames.length === 0) {
    return {
      data: {},
      capabilities,
      trace: {
        metric: "disk",
        resolvedFrom: null,
        quality: "low",
        attempts,
        missingSources: getMissingSourceIds(capabilities),
        recommendations: buildRecommendations(capabilities),
      },
    };
  }

  // 1) API
  {
    const startedAt = Date.now();
    try {
      if (!sourceAvailable(capabilities, "api")) {
        attempts.push({
          source: "api",
          status: "skipped",
          latencyMs: Date.now() - startedAt,
          message: "Kubelet API is not available",
        });
      } else if (await diskFromKubeletSummary.canResolve({ clusterId })) {
        const resolved = normalizeToArray(await diskFromKubeletSummary.resolve({ clusterId }));
        for (const item of resolved) {
          if (nodeNames.includes(item.name) && item.freeGiB > 0) {
            out[item.name] = formatGiB(item.freeGiB);
          }
        }

        attempts.push({
          source: "api",
          status: Object.keys(out).length > 0 ? "success" : "failed",
          latencyMs: Date.now() - startedAt,
          message: `Resolved ${Object.keys(out).length}/${nodeNames.length} node(s)`,
        });
      }
    } catch (err) {
      attempts.push({
        source: "api",
        status: "failed",
        latencyMs: Date.now() - startedAt,
        message: String(err),
      });
    }
  }

  // 2) metrics-server (no disk metric)
  attempts.push({
    source: "metrics_server",
    status: sourceAvailable(capabilities, "metrics_server") ? "failed" : "skipped",
    latencyMs: 0,
    message: sourceAvailable(capabilities, "metrics_server")
      ? "metrics-server does not provide node filesystem availability"
      : "metrics-server is not available",
  });

  // 3) node-exporter for unresolved nodes
  {
    const startedAt = Date.now();
    const missingBefore = nodeNames.filter((nodeName) => !(nodeName in out));

    try {
      if (!sourceAvailable(capabilities, "node_exporter")) {
        attempts.push({
          source: "node_exporter",
          status: "skipped",
          latencyMs: Date.now() - startedAt,
          message: "node-exporter is not available",
        });
      } else {
        await forEachWithConcurrency(
          missingBefore,
          NODE_EXPORTER_DISK_CONCURRENCY,
          async (nodeName) => {
            try {
              const disk = await getNodeAvailableDiskSpace(clusterId, nodeName, "/");
              if (disk.success && disk.availableGiB > 0) {
                out[nodeName] = formatGiB(disk.availableGiB);
              }
            } catch {
              // continue fallback chain
            }
          },
        );

        const missingAfter = nodeNames.filter((nodeName) => !(nodeName in out));
        attempts.push({
          source: "node_exporter",
          status: missingAfter.length < missingBefore.length ? "success" : "failed",
          latencyMs: Date.now() - startedAt,
          message: `Resolved ${missingBefore.length - missingAfter.length}/${missingBefore.length} node(s)`,
        });
      }
    } catch (err) {
      attempts.push({
        source: "node_exporter",
        status: "failed",
        latencyMs: Date.now() - startedAt,
        message: String(err),
      });
    }
  }

  // 4) Prometheus for unresolved nodes
  {
    const startedAt = Date.now();
    const missingBefore = nodeNames.filter((nodeName) => !(nodeName in out));

    try {
      if (!sourceAvailable(capabilities, "prometheus")) {
        attempts.push({
          source: "prometheus",
          status: "skipped",
          latencyMs: Date.now() - startedAt,
          message: "Prometheus is not available",
        });
      } else if (await diskFromPrometheus.canResolve({ clusterId })) {
        const resolved = normalizeToArray(await diskFromPrometheus.resolve({ clusterId }));
        for (const item of resolved) {
          if (missingBefore.includes(item.name) && item.freeGiB > 0) {
            out[item.name] = formatGiB(item.freeGiB);
          }
        }

        const missingAfter = nodeNames.filter((nodeName) => !(nodeName in out));
        attempts.push({
          source: "prometheus",
          status: missingAfter.length < missingBefore.length ? "success" : "failed",
          latencyMs: Date.now() - startedAt,
          message: `Resolved ${missingBefore.length - missingAfter.length}/${missingBefore.length} node(s)`,
        });
      }
    } catch (err) {
      attempts.push({
        source: "prometheus",
        status: "failed",
        latencyMs: Date.now() - startedAt,
        message: String(err),
      });
    }
  }

  for (const nodeName of nodeNames) {
    if (!(nodeName in out)) {
      out[nodeName] = "N/A";
    }
  }

  const firstSuccess = attempts.find((entry) => entry.status === "success")?.source ?? null;

  return {
    data: out,
    capabilities,
    trace: {
      metric: "disk",
      resolvedFrom: firstSuccess,
      quality: qualityFromSource(firstSuccess),
      attempts,
      missingSources: getMissingSourceIds(capabilities),
      recommendations: buildRecommendations(capabilities),
    },
  };
}

export async function resolveDisk(
  clusterId: string,
  nodeNames: string[],
): Promise<Record<string, string>> {
  const resolved = await resolveDiskWithTrace(clusterId, nodeNames);
  return resolved.data;
}
