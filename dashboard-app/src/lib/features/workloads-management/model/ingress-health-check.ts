/**
 * Ingress Health Check (#18)
 *
 * Evaluates ingress rules health: TLS config, backend availability, host resolution.
 */

type GenericItem = Record<string, unknown>;

export type IngressHealthEntry = {
  name: string;
  namespace: string;
  hosts: string[];
  hasTls: boolean;
  hasBackend: boolean;
  hasLoadBalancer: boolean;
  issues: string[];
  score: number;
};
export type IngressHealthReport = {
  entries: IngressHealthEntry[];
  totalIngresses: number;
  healthyCount: number;
  withoutTls: number;
  withoutBackend: number;
  averageScore: number;
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

export function evaluateIngressHealth(ingresses: GenericItem[]): IngressHealthReport {
  const entries: IngressHealthEntry[] = ingresses.map((ing) => {
    const metadata = asRecord(ing.metadata);
    const spec = asRecord(ing.spec);
    const status = asRecord(ing.status);
    const rules = asArray(spec.rules);
    const tls = asArray(spec.tls);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for future LB status display
    const lbIngress = asArray(
      (asRecord(asRecord(status.loadBalancer ?? {}).ingress ?? {}) as unknown) ?? [],
    );
    const hosts = rules.map((r) => asString(asRecord(r).host)).filter(Boolean);
    const hasBackend = rules.some((r) => asArray(asRecord(asRecord(r).http).paths).length > 0);
    const issues: string[] = [];
    let score = 100;

    if (tls.length === 0 && hosts.length > 0) {
      issues.push("No TLS configured");
      score -= 30;
    }
    if (!hasBackend) {
      issues.push("No backend paths defined");
      score -= 40;
    }
    if (hosts.length === 0) {
      issues.push("No hosts defined");
      score -= 20;
    }
    const hasLB =
      Array.isArray(asRecord(status.loadBalancer).ingress) &&
      (asRecord(status.loadBalancer).ingress as unknown[]).length > 0;
    if (!hasLB) {
      issues.push("No load balancer address assigned");
      score -= 10;
    }

    return {
      name: asString(metadata.name),
      namespace: asString(metadata.namespace),
      hosts,
      hasTls: tls.length > 0,
      hasBackend,
      hasLoadBalancer: hasLB,
      issues,
      score: Math.max(0, score),
    };
  });

  entries.sort((a, b) => a.score - b.score);
  const total = entries.length || 1;
  return {
    entries,
    totalIngresses: entries.length,
    healthyCount: entries.filter((e) => e.score >= 80).length,
    withoutTls: entries.filter((e) => !e.hasTls).length,
    withoutBackend: entries.filter((e) => !e.hasBackend).length,
    averageScore: Math.round(entries.reduce((s, e) => s + e.score, 0) / total),
  };
}
