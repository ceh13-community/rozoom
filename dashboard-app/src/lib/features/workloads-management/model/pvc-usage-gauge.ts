/**
 * PVC Usage Gauge (#19)
 *
 * Compares PVC provisioned capacity vs actual usage from kubelet metrics.
 */

export type PvcUsageEntry = {
  name: string;
  namespace: string;
  provisionedBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
  status: "healthy" | "warning" | "critical";
};
export type PvcUsageReport = {
  entries: PvcUsageEntry[];
  totalProvisioned: number;
  totalUsed: number;
  overallUsagePercent: number;
  criticalCount: number;
};

function parseBytes(v: string): number {
  const m = v.match(/^(\d+(?:\.\d+)?)\s*(Ki|Mi|Gi|Ti)?$/);
  if (!m) return parseInt(v) || 0;
  const mult: Record<string, number> = {
    "": 1,
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
  };
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- capture group may not match
  return parseFloat(m[1]) * (mult[m[2] ?? ""] ?? 1);
}

export function buildPvcUsageReport(
  pvcs: Array<{ name: string; namespace: string; capacity: string }>,
  metrics: Array<{ pvcName: string; namespace: string; usedBytes: number; availableBytes: number }>,
): PvcUsageReport {
  const metricsMap = new Map(metrics.map((m) => [`${m.namespace}/${m.pvcName}`, m]));
  const entries: PvcUsageEntry[] = [];
  let totalProv = 0,
    totalUsed = 0;

  for (const pvc of pvcs) {
    const key = `${pvc.namespace}/${pvc.name}`;
    const m = metricsMap.get(key);
    const provisioned = parseBytes(pvc.capacity);
    const used = m?.usedBytes ?? 0;
    const available = m?.availableBytes ?? provisioned;
    const percent = provisioned > 0 ? Math.round((used / provisioned) * 100) : 0;
    totalProv += provisioned;
    totalUsed += used;

    entries.push({
      name: pvc.name,
      namespace: pvc.namespace,
      provisionedBytes: provisioned,
      usedBytes: used,
      availableBytes: available,
      usagePercent: percent,
      status: percent >= 90 ? "critical" : percent >= 75 ? "warning" : "healthy",
    });
  }

  entries.sort((a, b) => b.usagePercent - a.usagePercent);
  return {
    entries,
    totalProvisioned: totalProv,
    totalUsed: totalUsed,
    overallUsagePercent: totalProv > 0 ? Math.round((totalUsed / totalProv) * 100) : 0,
    criticalCount: entries.filter((e) => e.status === "critical").length,
  };
}
