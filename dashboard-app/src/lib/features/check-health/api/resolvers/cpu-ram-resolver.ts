import { error } from "@tauri-apps/plugin-log";
import { getNodeMetrics } from "$shared/api/tauri";
import type { NodeCpuMem } from "../metrics-resolvers";
import { cpuRamFromKubeletSummary, cpuRamFromPrometheus } from "../metrics-resolvers";
import {
  buildRecommendations,
  getMetricsSourceCapabilities,
  getMissingSourceIds,
  type MetricsFlowTrace,
  type MetricsSourceAttempt,
  type MetricsSourceCapability,
} from "./metrics-capabilities";

function normalizeToArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

function qualityFromSource(source: MetricsFlowTrace["resolvedFrom"]): MetricsFlowTrace["quality"] {
  if (source === "api" || source === "metrics_server") return "high";
  if (source === "node_exporter" || source === "prometheus") return "medium";
  return "low";
}

function sourceAvailable(
  capabilities: MetricsSourceCapability[],
  id: MetricsSourceAttempt["source"],
): boolean {
  const source = capabilities.find((entry) => entry.id === id);
  return Boolean(source?.available);
}

export async function resolveCpuRamWithTrace(
  clusterId: string,
  options?: { allowPrometheusFallback?: boolean },
): Promise<{
  data: NodeCpuMem[];
  trace: MetricsFlowTrace;
  capabilities: MetricsSourceCapability[];
}> {
  const attempts: MetricsSourceAttempt[] = [];
  const capabilities = await getMetricsSourceCapabilities(clusterId);
  const allowPrometheusFallback = options?.allowPrometheusFallback !== false;

  let resolvedFrom: MetricsFlowTrace["resolvedFrom"] = null;

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
      } else if (await cpuRamFromKubeletSummary.canResolve({ clusterId })) {
        const result = await cpuRamFromKubeletSummary.resolve({ clusterId });
        const data = normalizeToArray(result);
        if (data.length > 0) {
          attempts.push({
            source: "api",
            status: "success",
            latencyMs: Date.now() - startedAt,
            message: `Resolved ${data.length} node(s)`,
          });
          resolvedFrom = "api";
          return {
            data,
            capabilities,
            trace: {
              metric: "cpu_memory",
              resolvedFrom,
              quality: qualityFromSource(resolvedFrom),
              attempts,
              missingSources: getMissingSourceIds(capabilities),
              recommendations: buildRecommendations(capabilities),
            },
          };
        }
      }

      attempts.push({
        source: "api",
        status: "failed",
        latencyMs: Date.now() - startedAt,
        message: "No CPU/RAM data from kubelet summary",
      });
    } catch (err) {
      await error(`CPU/RAM API resolver failed for cluster ${clusterId}: ${String(err)}`);
      attempts.push({
        source: "api",
        status: "failed",
        latencyMs: Date.now() - startedAt,
        message: String(err),
      });
    }
  }

  // 2) metrics-server
  {
    const startedAt = Date.now();
    try {
      if (!sourceAvailable(capabilities, "metrics_server")) {
        attempts.push({
          source: "metrics_server",
          status: "skipped",
          latencyMs: Date.now() - startedAt,
          message: "metrics-server is not available",
        });
      } else {
        const metrics = await getNodeMetrics(clusterId);
        const data = Array.isArray(metrics) ? metrics : [];

        if (data.length > 0) {
          attempts.push({
            source: "metrics_server",
            status: "success",
            latencyMs: Date.now() - startedAt,
            message: `Resolved ${data.length} node(s)`,
          });
          resolvedFrom = "metrics_server";
          return {
            data,
            capabilities,
            trace: {
              metric: "cpu_memory",
              resolvedFrom,
              quality: qualityFromSource(resolvedFrom),
              attempts,
              missingSources: getMissingSourceIds(capabilities),
              recommendations: buildRecommendations(capabilities),
            },
          };
        }

        attempts.push({
          source: "metrics_server",
          status: "failed",
          latencyMs: Date.now() - startedAt,
          message: "No rows from metrics-server",
        });
      }
    } catch (err) {
      await error(
        `CPU/RAM metrics-server resolver failed for cluster ${clusterId}: ${String(err)}`,
      );
      attempts.push({
        source: "metrics_server",
        status: "failed",
        latencyMs: Date.now() - startedAt,
        message: String(err),
      });
    }
  }

  // 3) node-exporter (not implemented for CPU percentage here)
  attempts.push({
    source: "node_exporter",
    status: !allowPrometheusFallback
      ? "skipped"
      : sourceAvailable(capabilities, "node_exporter")
        ? "failed"
        : "skipped",
    latencyMs: 0,
    message: !allowPrometheusFallback
      ? "Prometheus-style fallbacks are disabled"
      : sourceAvailable(capabilities, "node_exporter")
        ? "CPU/RAM extraction from node-exporter is not implemented in this resolver"
        : "node-exporter is not available",
  });

  // 4) Prometheus
  if (!allowPrometheusFallback) {
    attempts.push({
      source: "prometheus",
      status: "skipped",
      latencyMs: 0,
      message: "Prometheus fallback is disabled",
    });
    return {
      data: [],
      capabilities,
      trace: {
        metric: "cpu_memory",
        resolvedFrom,
        quality: qualityFromSource(resolvedFrom),
        attempts,
        missingSources: getMissingSourceIds(capabilities),
        recommendations: buildRecommendations(capabilities),
      },
    };
  }

  {
    const startedAt = Date.now();
    try {
      if (!sourceAvailable(capabilities, "prometheus")) {
        attempts.push({
          source: "prometheus",
          status: "skipped",
          latencyMs: Date.now() - startedAt,
          message: "Prometheus is not available",
        });
      } else if (await cpuRamFromPrometheus.canResolve({ clusterId })) {
        const result = await cpuRamFromPrometheus.resolve({ clusterId });
        const data = normalizeToArray(result);

        if (data.length > 0) {
          attempts.push({
            source: "prometheus",
            status: "success",
            latencyMs: Date.now() - startedAt,
            message: `Resolved ${data.length} node(s)`,
          });
          resolvedFrom = "prometheus";
          return {
            data,
            capabilities,
            trace: {
              metric: "cpu_memory",
              resolvedFrom,
              quality: qualityFromSource(resolvedFrom),
              attempts,
              missingSources: getMissingSourceIds(capabilities),
              recommendations: buildRecommendations(capabilities),
            },
          };
        }
      }

      attempts.push({
        source: "prometheus",
        status: "failed",
        latencyMs: Date.now() - startedAt,
        message: "No CPU/RAM data from Prometheus",
      });
    } catch (err) {
      await error(`CPU/RAM Prometheus resolver failed for cluster ${clusterId}: ${String(err)}`);
      attempts.push({
        source: "prometheus",
        status: "failed",
        latencyMs: Date.now() - startedAt,
        message: String(err),
      });
    }
  }

  return {
    data: [],
    capabilities,
    trace: {
      metric: "cpu_memory",
      resolvedFrom,
      quality: qualityFromSource(resolvedFrom),
      attempts,
      missingSources: getMissingSourceIds(capabilities),
      recommendations: buildRecommendations(capabilities),
    },
  };
}

export async function resolveCpuRam(clusterId: string): Promise<NodeCpuMem[]> {
  const resolved = await resolveCpuRamWithTrace(clusterId);
  return resolved.data;
}
