/**
 * Namespace Cost View (#5)
 *
 * Estimates cost per namespace based on CPU/memory requests.
 */

type GenericItem = Record<string, unknown>;

export type NamespaceCostEntry = {
  namespace: string;
  cpuRequestMillicores: number;
  memoryRequestMiB: number;
  podCount: number;
  estimatedMonthlyCost: number;
  costPercent: number;
};

export type NamespaceCostReport = {
  entries: NamespaceCostEntry[];
  totalCpuMillicores: number;
  totalMemoryMiB: number;
  totalMonthlyCost: number;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function asString(v: unknown, f = ""): string {
  return typeof v === "string" ? v : f;
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function parseCpu(v: string): number {
  if (v.endsWith("m")) return parseInt(v);
  const n = parseFloat(v);
  return Number.isFinite(n) ? n * 1000 : 0;
}

function parseMemory(v: string): number {
  const match = v.match(/^(\d+(?:\.\d+)?)\s*(Ki|Mi|Gi|Ti|k|M|G|T)?$/);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- capture group may not match
  const unit = match[2] ?? "";
  const mult: Record<string, number> = {
    "": 1 / 1048576,
    k: 1 / 1024,
    Ki: 1 / 1024,
    M: 1,
    Mi: 1,
    G: 1024,
    Gi: 1024,
    T: 1048576,
    Ti: 1048576,
  };
  return val * (mult[unit] ?? 0);
}

const DEFAULT_CPU_COST_PER_CORE_MONTH = 30;
const DEFAULT_MEMORY_COST_PER_GIB_MONTH = 4;

export function estimateNamespaceCosts(
  pods: GenericItem[],
  pricing?: { cpuPerCoreMonth?: number; memoryPerGiBMonth?: number },
): NamespaceCostReport {
  const cpuCost = pricing?.cpuPerCoreMonth ?? DEFAULT_CPU_COST_PER_CORE_MONTH;
  const memCost = pricing?.memoryPerGiBMonth ?? DEFAULT_MEMORY_COST_PER_GIB_MONTH;
  const nsMap = new Map<string, { cpu: number; mem: number; pods: number }>();

  for (const pod of pods) {
    const ns = asString(asRecord(pod.metadata).namespace, "default");
    const entry = nsMap.get(ns) ?? { cpu: 0, mem: 0, pods: 0 };
    entry.pods++;
    for (const c of [
      ...asArray(asRecord(pod.spec).containers),
      ...asArray(asRecord(pod.spec).initContainers),
    ]) {
      const resources = asRecord(asRecord(c).resources);
      const requests = asRecord(resources.requests);
      entry.cpu += parseCpu(asString(requests.cpu));
      entry.mem += parseMemory(asString(requests.memory));
    }
    nsMap.set(ns, entry);
  }

  let totalCpu = 0,
    totalMem = 0,
    totalCost = 0;
  const entries: NamespaceCostEntry[] = [];

  for (const [namespace, data] of nsMap) {
    const monthlyCost = (data.cpu / 1000) * cpuCost + (data.mem / 1024) * memCost;
    totalCpu += data.cpu;
    totalMem += data.mem;
    totalCost += monthlyCost;
    entries.push({
      namespace,
      cpuRequestMillicores: data.cpu,
      memoryRequestMiB: Math.round(data.mem),
      podCount: data.pods,
      estimatedMonthlyCost: Math.round(monthlyCost * 100) / 100,
      costPercent: 0,
    });
  }

  for (const e of entries)
    e.costPercent = totalCost > 0 ? Math.round((e.estimatedMonthlyCost / totalCost) * 100) : 0;
  entries.sort((a, b) => b.estimatedMonthlyCost - a.estimatedMonthlyCost);

  return {
    entries,
    totalCpuMillicores: totalCpu,
    totalMemoryMiB: Math.round(totalMem),
    totalMonthlyCost: Math.round(totalCost * 100) / 100,
  };
}
