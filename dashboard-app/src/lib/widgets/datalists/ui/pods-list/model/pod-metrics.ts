import type { PodItem } from "$shared/model/clusters";
import { getPodMetricsKey, type PodMetricsValue } from "./pod-row-adapter";

function parseCpuMillicores(raw: string) {
  if (!raw) return -1;
  const trimmed = raw.trim();
  if (trimmed.endsWith("m")) {
    const value = Number(trimmed.slice(0, -1));
    return Number.isFinite(value) ? value : -1;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? Math.round(value * 1000) : -1;
}

function parseMemoryBytes(raw: string) {
  if (!raw) return -1;
  const match = /^([0-9.]+)(Ki|Mi|Gi|Ti|K|M|G|T)?$/.exec(raw.trim());
  if (!match) return -1;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return -1;
  const unit = match[2] || "";
  const multipliers: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
  };
  return Math.round(amount * (multipliers[unit] ?? 1));
}

export function parseTopPodMetricsOutput(output: string) {
  const metrics = new Map<string, PodMetricsValue>();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [namespace, name, cpu, memory] = trimmed.split(/\s+/);
    if (!namespace || !name) continue;
    metrics.set(`${namespace}/${name}`, {
      cpu: cpu || "-",
      memory: memory || "-",
      cpuMillicores: parseCpuMillicores(cpu || ""),
      memoryBytes: parseMemoryBytes(memory || ""),
    });
  }
  return metrics;
}

export function filterMetricsForPods(
  metrics: Map<string, PodMetricsValue>,
  pods: Partial<PodItem>[],
) {
  const filtered = new Map<string, PodMetricsValue>();
  for (const pod of pods) {
    const key = getPodMetricsKey(pod);
    const value = metrics.get(key);
    if (value) {
      filtered.set(key, value);
    }
  }
  return filtered;
}
