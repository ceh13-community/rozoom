/**
 * CRD Instance Health (#14)
 *
 * Evaluates health of CRD instances based on status conditions.
 */

type GenericItem = Record<string, unknown>;

export type CrdInstanceHealth = {
  name: string;
  namespace: string;
  crdKind: string;
  healthy: boolean;
  conditions: Array<{ type: string; status: string; reason: string }>;
  summary: string;
};
export type CrdHealthReport = {
  instances: CrdInstanceHealth[];
  totalInstances: number;
  healthyCount: number;
  unhealthyCount: number;
  healthPercent: number;
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

export function evaluateCrdInstanceHealth(
  instances: GenericItem[],
  crdKind: string,
): CrdHealthReport {
  const results: CrdInstanceHealth[] = instances.map((item) => {
    const metadata = asRecord(item.metadata);
    const status = asRecord(item.status);
    const conditions = asArray(status.conditions).map((c) => {
      const cond = asRecord(c);
      return {
        type: asString(cond.type),
        status: asString(cond.status),
        reason: asString(cond.reason),
      };
    });
    const readyCond = conditions.find(
      (c) => c.type === "Ready" || c.type === "Available" || c.type === "Established",
    );
    const healthy = readyCond ? readyCond.status === "True" : conditions.length === 0;
    const summary = readyCond
      ? `${readyCond.type}=${readyCond.status}`
      : conditions.length === 0
        ? "No conditions"
        : conditions.map((c) => `${c.type}=${c.status}`).join(", ");

    return {
      name: asString(metadata.name),
      namespace: asString(metadata.namespace, "cluster"),
      crdKind,
      healthy,
      conditions,
      summary,
    };
  });

  const healthy = results.filter((r) => r.healthy).length;
  return {
    instances: results,
    totalInstances: results.length,
    healthyCount: healthy,
    unhealthyCount: results.length - healthy,
    healthPercent: results.length > 0 ? Math.round((healthy / results.length) * 100) : 100,
  };
}
