import { warn as logWarn } from "@tauri-apps/plugin-log";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import type { NodeUtilizationNode, NodeUtilizationReport } from "../model/types";
import {
  markFeatureCapability,
  markFeatureCapabilityFromReason,
  shouldSkipFeatureProbe,
} from "../model/feature-capability-cache";

const CACHE_MS = 60 * 1000;
const NODE_UTILIZATION_FEATURE_ID = "node-utilization";
const cachedReports = new Map<string, { data: NodeUtilizationReport; fetchedAt: number }>();
const loggedUnavailable = new Set<string>();

function parseLine(line: string): NodeUtilizationNode | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 5) return null;
  const name = parts[0];
  const cpuCores = parts[1];
  const cpuPercentRaw = parts[2];
  const memoryBytes = parts[3];
  const memoryPercentRaw = parts[4];
  const cpuPercent = parseInt(cpuPercentRaw.replace("%", ""), 10);
  const memoryPercent = parseInt(memoryPercentRaw.replace("%", ""), 10);
  if (Number.isNaN(cpuPercent) || Number.isNaN(memoryPercent)) return null;
  return { name, cpuCores, cpuPercent, memoryBytes, memoryPercent };
}

function buildUnknownReport(): NodeUtilizationReport {
  return {
    status: "unknown",
    summary: {
      avgCpuPercent: 0,
      avgMemoryPercent: 0,
      maxCpuPercent: 0,
      maxMemoryPercent: 0,
      nodeCount: 0,
    },
    nodes: [],
    updatedAt: Date.now(),
  };
}

export async function checkNodeUtilization(
  clusterId: string,
  options?: { force?: boolean },
): Promise<NodeUtilizationReport> {
  const cached = cachedReports.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.data;
  }

  if (
    !options?.force &&
    shouldSkipFeatureProbe(clusterId, NODE_UTILIZATION_FEATURE_ID, {
      statuses: ["unavailable", "unreachable"],
    })
  ) {
    const report = buildUnknownReport();
    cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
    return report;
  }

  let errorMessage: string | undefined;
  const nodes: NodeUtilizationNode[] = [];

  try {
    const result = await kubectlRawFront(`top nodes --no-headers`, { clusterId });
    if (result.errors && result.code !== 0) {
      errorMessage = result.errors || "Failed to fetch node utilization.";
    } else {
      const lines = result.output.split("\n");
      for (const line of lines) {
        const parsed = parseLine(line);
        if (parsed) nodes.push(parsed);
      }
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to fetch node utilization.";
  }

  if (errorMessage || nodes.length === 0) {
    markFeatureCapabilityFromReason(clusterId, NODE_UTILIZATION_FEATURE_ID, errorMessage);
    if (!loggedUnavailable.has(clusterId)) {
      loggedUnavailable.add(clusterId);
      await logWarn(`Node utilization unavailable for ${clusterId}: ${errorMessage}`);
    }
    const report = buildUnknownReport();
    cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
    return report;
  }

  markFeatureCapability(clusterId, NODE_UTILIZATION_FEATURE_ID, { status: "available" });
  loggedUnavailable.delete(clusterId);

  const nodeCount = nodes.length;
  const avgCpuPercent = Math.round(nodes.reduce((s, n) => s + n.cpuPercent, 0) / nodeCount);
  const avgMemoryPercent = Math.round(nodes.reduce((s, n) => s + n.memoryPercent, 0) / nodeCount);
  const maxCpuPercent = Math.max(...nodes.map((n) => n.cpuPercent));
  const maxMemoryPercent = Math.max(...nodes.map((n) => n.memoryPercent));

  let status: "ok" | "warning" | "critical" | "unknown";
  if (maxCpuPercent > 90 || maxMemoryPercent > 90) {
    status = "critical";
  } else if (maxCpuPercent > 75 || maxMemoryPercent > 75) {
    status = "warning";
  } else {
    status = "ok";
  }

  const report: NodeUtilizationReport = {
    status,
    summary: { avgCpuPercent, avgMemoryPercent, maxCpuPercent, maxMemoryPercent, nodeCount },
    nodes,
    updatedAt: Date.now(),
  };

  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
