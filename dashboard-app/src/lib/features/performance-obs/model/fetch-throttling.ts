/**
 * Fetch CPU throttling counters from cAdvisor metrics exposed by kubelet
 * and scraped by Prometheus. cAdvisor emits
 *   container_cpu_cfs_throttled_periods_total
 *   container_cpu_cfs_periods_total
 * for every running container, which are the standard signals for CFS
 * quota throttling. See:
 *   https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/#how-pods-with-resource-limits-are-run
 *   https://github.com/google/cadvisor/blob/master/docs/storage/prometheus.md
 */

import { extractScalars, instantQuery } from "./prometheus-client";
import type { PrometheusEndpoint } from "./prometheus-discovery";
import {
  detectCpuThrottling,
  type CpuThrottlingReport,
} from "$features/workloads-management/model/cpu-throttling";

function keyOf(tags: Record<string, string>): string {
  return `${tags.namespace}|${tags.pod}|${tags.container}`;
}

/**
 * Pull throttling + usage counters for every non-excluded container and
 * feed them into the existing detector. Returns null when Prometheus is
 * reachable but has no cAdvisor data (e.g. metrics not scraped).
 */
export async function fetchCpuThrottling(
  clusterId: string,
  endpoint: PrometheusEndpoint,
  window: string = "5m",
): Promise<CpuThrottlingReport | null> {
  // Exclude empty container labels (pod-level cgroup totals emitted by
  // cAdvisor with container="") because they double-count per pod.
  const throttledQuery = `sum by (namespace, pod, container) (rate(container_cpu_cfs_throttled_periods_total{container!=""}[${window}]))`;
  const totalQuery = `sum by (namespace, pod, container) (rate(container_cpu_cfs_periods_total{container!=""}[${window}]))`;
  const usageQuery = `sum by (namespace, pod, container) (rate(container_cpu_usage_seconds_total{container!=""}[${window}])) * 1000`;
  const limitQuery = `sum by (namespace, pod, container) (kube_pod_container_resource_limits{resource="cpu", unit="core"}) * 1000`;

  const [thResp, totResp, useResp, limResp] = await Promise.all([
    instantQuery(clusterId, endpoint, throttledQuery),
    instantQuery(clusterId, endpoint, totalQuery),
    instantQuery(clusterId, endpoint, usageQuery),
    instantQuery(clusterId, endpoint, limitQuery),
  ]);

  if (!thResp || !totResp) return null;

  const thMap = new Map<string, { tags: Record<string, string>; value: number }>();
  for (const r of extractScalars(thResp, ["namespace", "pod", "container"])) {
    thMap.set(keyOf(r.tags), r);
  }
  const totMap = new Map<string, number>();
  for (const r of extractScalars(totResp, ["namespace", "pod", "container"])) {
    totMap.set(keyOf(r.tags), r.value);
  }
  const useMap = new Map<string, number>();
  for (const r of extractScalars(useResp, ["namespace", "pod", "container"])) {
    useMap.set(keyOf(r.tags), r.value);
  }
  const limMap = new Map<string, number>();
  for (const r of extractScalars(limResp, ["namespace", "pod", "container"])) {
    limMap.set(keyOf(r.tags), r.value);
  }

  // Use rate-per-second as "periods" - the detector divides throttled by
  // total so the absolute scale cancels out, but it expects both to be
  // whole numbers. We approximate by scaling by the window length so the
  // ratio and the raw counts both remain meaningful to a reader.
  const inputs = Array.from(thMap.values()).map(({ tags, value }) => {
    const key = keyOf(tags);
    const throttledPeriods = Math.round(value * 300);
    const totalPeriods = Math.round((totMap.get(key) ?? 0) * 300);
    const cpuUsageMillicores = Math.round(useMap.get(key) ?? 0);
    const cpuLimitMillicores = Math.round(limMap.get(key) ?? 0);
    return {
      namespace: tags.namespace,
      pod: tags.pod,
      container: tags.container,
      throttledPeriods,
      totalPeriods,
      cpuUsageMillicores,
      cpuLimitMillicores,
    };
  });

  return detectCpuThrottling(inputs);
}
