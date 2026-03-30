export type ResourceHeatmapEntry = {
  namespace: string;
  workload: string;
  workloadType: string;
  cpuRequestMillicores: number;
  cpuUsageMillicores: number;
  cpuEfficiency: number;
  memoryRequestMiB: number;
  memoryUsageMiB: number;
  memoryEfficiency: number;
  overallEfficiency: number;
  grade: "optimal" | "over-provisioned" | "under-provisioned" | "no-requests" | "idle";
};

export type ResourceHeatmapReport = {
  entries: ResourceHeatmapEntry[];
  summary: {
    totalCpuRequested: number;
    totalCpuUsed: number;
    totalMemoryRequested: number;
    totalMemoryUsed: number;
    avgCpuEfficiency: number;
    avgMemoryEfficiency: number;
    overProvisionedCount: number;
    underProvisionedCount: number;
    noRequestsCount: number;
    optimalCount: number;
    idleCount: number;
  };
};

type PodMetric = {
  namespace: string;
  workload: string;
  workloadType: string;
  cpuRequestMillicores: number;
  cpuUsageMillicores: number;
  memoryRequestMiB: number;
  memoryUsageMiB: number;
};

export function parseCpuToMillicores(value: string | undefined | null): number {
  if (!value) return 0;
  const str = value.trim();
  if (str.endsWith("m")) return parseFloat(str) || 0;
  if (str.endsWith("n")) return (parseFloat(str) || 0) / 1_000_000;
  return (parseFloat(str) || 0) * 1000;
}

export function parseMemoryToMiB(value: string | undefined | null): number {
  if (!value) return 0;
  const str = value.trim();
  const num = parseFloat(str) || 0;
  // Binary SI (K8s standard): Ki, Mi, Gi, Ti, Pi, Ei
  if (str.endsWith("Ei")) return num * 1024 * 1024 * 1024 * 1024;
  if (str.endsWith("Pi")) return num * 1024 * 1024 * 1024;
  if (str.endsWith("Ti")) return num * 1024 * 1024;
  if (str.endsWith("Gi")) return num * 1024;
  if (str.endsWith("Mi")) return num;
  if (str.endsWith("Ki")) return num / 1024;
  // Decimal SI: E, P, T, G, M, k (lowercase per K8s spec)
  if (str.endsWith("E")) return (num * 1e18) / (1024 * 1024);
  if (str.endsWith("P")) return (num * 1e15) / (1024 * 1024);
  if (str.endsWith("T")) return (num * 1e12) / (1024 * 1024);
  if (str.endsWith("G")) return (num * 1e9) / (1024 * 1024);
  if (str.endsWith("M")) return (num * 1e6) / (1024 * 1024);
  if (str.endsWith("k") || str.endsWith("K")) return (num * 1e3) / (1024 * 1024);
  // Plain bytes (no suffix)
  return num / (1024 * 1024);
}

function computeEfficiency(requested: number, used: number): number {
  if (requested <= 0) return 0;
  return Math.round((used / requested) * 100);
}

function gradeEntry(entry: {
  cpuRequestMillicores: number;
  memoryRequestMiB: number;
  cpuEfficiency: number;
  memoryEfficiency: number;
  cpuUsageMillicores: number;
  memoryUsageMiB: number;
}): ResourceHeatmapEntry["grade"] {
  if (entry.cpuRequestMillicores === 0 && entry.memoryRequestMiB === 0) {
    return "no-requests";
  }

  if (entry.cpuUsageMillicores === 0 && entry.memoryUsageMiB === 0) {
    return "idle";
  }

  const avgEff = (entry.cpuEfficiency + entry.memoryEfficiency) / 2;

  if (avgEff > 100) return "under-provisioned";
  if (avgEff < 20) return "over-provisioned";
  return "optimal";
}

export function buildResourceHeatmap(metrics: PodMetric[]): ResourceHeatmapReport {
  const grouped = new Map<string, PodMetric[]>();

  for (const m of metrics) {
    const key = `${m.namespace}/${m.workloadType}/${m.workload}`;
    const list = grouped.get(key) ?? [];
    list.push(m);
    grouped.set(key, list);
  }

  const entries: ResourceHeatmapEntry[] = [];

  for (const [, pods] of grouped) {
    const first = pods[0];
    let cpuReq = 0;
    let cpuUse = 0;
    let memReq = 0;
    let memUse = 0;

    for (const p of pods) {
      cpuReq += p.cpuRequestMillicores;
      cpuUse += p.cpuUsageMillicores;
      memReq += p.memoryRequestMiB;
      memUse += p.memoryUsageMiB;
    }

    const cpuEff = computeEfficiency(cpuReq, cpuUse);
    const memEff = computeEfficiency(memReq, memUse);
    const overallEff = cpuReq + memReq > 0 ? Math.round((cpuEff + memEff) / 2) : 0;

    const entry: ResourceHeatmapEntry = {
      namespace: first.namespace,
      workload: first.workload,
      workloadType: first.workloadType,
      cpuRequestMillicores: Math.round(cpuReq),
      cpuUsageMillicores: Math.round(cpuUse),
      cpuEfficiency: cpuEff,
      memoryRequestMiB: Math.round(memReq),
      memoryUsageMiB: Math.round(memUse),
      memoryEfficiency: memEff,
      overallEfficiency: overallEff,
      grade: "optimal",
    };
    entry.grade = gradeEntry(entry);
    entries.push(entry);
  }

  entries.sort((a, b) => a.overallEfficiency - b.overallEfficiency);

  const totalCpuReq = entries.reduce((s, e) => s + e.cpuRequestMillicores, 0);
  const totalCpuUse = entries.reduce((s, e) => s + e.cpuUsageMillicores, 0);
  const totalMemReq = entries.reduce((s, e) => s + e.memoryRequestMiB, 0);
  const totalMemUse = entries.reduce((s, e) => s + e.memoryUsageMiB, 0);
  const withRequests = entries.filter((e) => e.grade !== "no-requests" && e.grade !== "idle");
  const avgCpuEff =
    withRequests.length > 0
      ? Math.round(withRequests.reduce((s, e) => s + e.cpuEfficiency, 0) / withRequests.length)
      : 0;
  const avgMemEff =
    withRequests.length > 0
      ? Math.round(withRequests.reduce((s, e) => s + e.memoryEfficiency, 0) / withRequests.length)
      : 0;

  return {
    entries,
    summary: {
      totalCpuRequested: totalCpuReq,
      totalCpuUsed: totalCpuUse,
      totalMemoryRequested: totalMemReq,
      totalMemoryUsed: totalMemUse,
      avgCpuEfficiency: avgCpuEff,
      avgMemoryEfficiency: avgMemEff,
      overProvisionedCount: entries.filter((e) => e.grade === "over-provisioned").length,
      underProvisionedCount: entries.filter((e) => e.grade === "under-provisioned").length,
      noRequestsCount: entries.filter((e) => e.grade === "no-requests").length,
      optimalCount: entries.filter((e) => e.grade === "optimal").length,
      idleCount: entries.filter((e) => e.grade === "idle").length,
    },
  };
}
