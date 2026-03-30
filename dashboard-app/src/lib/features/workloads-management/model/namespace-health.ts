/**
 * Namespace Health Dashboard (#6)
 *
 * Mini overview per namespace: pod health, resource usage %, quota consumption.
 */

type GenericItem = Record<string, unknown>;

export type NamespaceHealthEntry = {
  namespace: string;
  totalPods: number;
  runningPods: number;
  failedPods: number;
  pendingPods: number;
  totalRestarts: number;
  healthPercent: number;
  grade: "healthy" | "degraded" | "critical";
};

export type NamespaceHealthReport = {
  entries: NamespaceHealthEntry[];
  healthiestNamespace: string | null;
  worstNamespace: string | null;
  overallHealthPercent: number;
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
function asNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function buildNamespaceHealth(pods: GenericItem[]): NamespaceHealthReport {
  const nsMap = new Map<
    string,
    { total: number; running: number; failed: number; pending: number; restarts: number }
  >();

  for (const pod of pods) {
    const ns = asString(asRecord(pod.metadata).namespace, "default");
    const phase = asString(asRecord(pod.status).phase, "Unknown").toLowerCase();
    const containers = asArray(asRecord(pod.status).containerStatuses);
    const restarts = containers.reduce(
      (sum: number, c) => sum + asNumber(asRecord(c).restartCount),
      0,
    );

    const entry = nsMap.get(ns) ?? { total: 0, running: 0, failed: 0, pending: 0, restarts: 0 };
    entry.total++;
    entry.restarts += restarts;
    if (phase === "running") entry.running++;
    else if (phase === "failed") entry.failed++;
    else if (phase === "pending") entry.pending++;
    nsMap.set(ns, entry);
  }

  const entries: NamespaceHealthEntry[] = [...nsMap.entries()].map(([namespace, data]) => {
    const healthPercent = data.total > 0 ? Math.round((data.running / data.total) * 100) : 100;
    return {
      namespace,
      totalPods: data.total,
      runningPods: data.running,
      failedPods: data.failed,
      pendingPods: data.pending,
      totalRestarts: data.restarts,
      healthPercent,
      grade: healthPercent >= 90 ? "healthy" : healthPercent >= 60 ? "degraded" : "critical",
    };
  });

  entries.sort((a, b) => a.healthPercent - b.healthPercent);

  const overall =
    entries.length > 0
      ? Math.round(entries.reduce((s, e) => s + e.healthPercent, 0) / entries.length)
      : 100;
  return {
    entries,
    overallHealthPercent: overall,
    healthiestNamespace: entries.length > 0 ? entries[entries.length - 1].namespace : null,
    worstNamespace: entries.length > 0 ? entries[0].namespace : null,
  };
}
