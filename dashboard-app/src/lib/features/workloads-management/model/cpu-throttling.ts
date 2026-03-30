/**
 * CPU throttling detector.
 *
 * Based on:
 *   - https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
 *     "CPU limits are enforced by CPU throttling via CFS quota"
 *   - cAdvisor metrics: container_cpu_cfs_throttled_periods_total,
 *     container_cpu_cfs_periods_total
 *   - https://aws.amazon.com/blogs/containers/using-prometheus-to-avoid-disasters-with-kubernetes-cpu-limits/
 *
 * Throttling % = throttled_periods / total_periods * 100
 * Alert thresholds: >5% warning, >25% critical (industry best practice)
 */

export type CpuThrottlingEntry = {
  namespace: string;
  pod: string;
  container: string;
  throttledPeriods: number;
  totalPeriods: number;
  throttlingPercent: number;
  cpuLimitMillicores: number;
  cpuUsageMillicores: number;
  status: "ok" | "warning" | "critical";
  recommendation: string;
};

export type CpuThrottlingReport = {
  entries: CpuThrottlingEntry[];
  summary: {
    totalContainers: number;
    throttledContainers: number;
    warningCount: number;
    criticalCount: number;
    avgThrottlingPercent: number;
  };
};

const WARNING_THRESHOLD = 5;
const CRITICAL_THRESHOLD = 25;

type ThrottlingInput = {
  namespace: string;
  pod: string;
  container: string;
  throttledPeriods: number;
  totalPeriods: number;
  cpuLimitMillicores: number;
  cpuUsageMillicores: number;
};

function gradeThrottling(percent: number): CpuThrottlingEntry["status"] {
  if (percent >= CRITICAL_THRESHOLD) return "critical";
  if (percent >= WARNING_THRESHOLD) return "warning";
  return "ok";
}

function recommendFix(entry: ThrottlingInput, percent: number): string {
  if (percent < WARNING_THRESHOLD) return "";

  if (entry.cpuLimitMillicores > 0 && entry.cpuUsageMillicores > 0) {
    const ratio = entry.cpuUsageMillicores / entry.cpuLimitMillicores;
    if (ratio > 0.8) {
      const suggested = Math.ceil(entry.cpuUsageMillicores * 1.5);
      return `Increase CPU limit to ${suggested}m (current: ${entry.cpuLimitMillicores}m, usage: ${entry.cpuUsageMillicores}m)`;
    }
    return `CPU limit ${entry.cpuLimitMillicores}m may be too low for burst workloads. Consider increasing or removing the limit.`;
  }

  return "Review CPU limits - throttling detected but usage data unavailable.";
}

export function detectCpuThrottling(inputs: ThrottlingInput[]): CpuThrottlingReport {
  const entries: CpuThrottlingEntry[] = inputs.map((input) => {
    const percent =
      input.totalPeriods > 0
        ? Math.round((input.throttledPeriods / input.totalPeriods) * 10000) / 100
        : 0;

    return {
      namespace: input.namespace,
      pod: input.pod,
      container: input.container,
      throttledPeriods: input.throttledPeriods,
      totalPeriods: input.totalPeriods,
      throttlingPercent: percent,
      cpuLimitMillicores: input.cpuLimitMillicores,
      cpuUsageMillicores: input.cpuUsageMillicores,
      status: gradeThrottling(percent),
      recommendation: recommendFix(input, percent),
    };
  });

  entries.sort((a, b) => b.throttlingPercent - a.throttlingPercent);

  const throttled = entries.filter((e) => e.throttlingPercent >= WARNING_THRESHOLD);
  const avgPercent =
    entries.length > 0
      ? Math.round((entries.reduce((s, e) => s + e.throttlingPercent, 0) / entries.length) * 100) /
        100
      : 0;

  return {
    entries,
    summary: {
      totalContainers: entries.length,
      throttledContainers: throttled.length,
      warningCount: entries.filter((e) => e.status === "warning").length,
      criticalCount: entries.filter((e) => e.status === "critical").length,
      avgThrottlingPercent: avgPercent,
    },
  };
}

/**
 * PromQL queries for CPU throttling detection.
 *
 * container_cpu_cfs_throttled_periods_total and container_cpu_cfs_periods_total
 * are standard cAdvisor metrics exposed by kubelet.
 */
export const THROTTLING_PROMQL = {
  throttlingPercent: (namespace: string, window: string) =>
    `sum by (pod, container) (rate(container_cpu_cfs_throttled_periods_total{namespace="${namespace}"}[${window}])) / sum by (pod, container) (rate(container_cpu_cfs_periods_total{namespace="${namespace}"}[${window}])) * 100`,
  cpuUsage: (namespace: string, window: string) =>
    `sum by (pod, container) (rate(container_cpu_usage_seconds_total{namespace="${namespace}"}[${window}])) * 1000`,
} as const;
