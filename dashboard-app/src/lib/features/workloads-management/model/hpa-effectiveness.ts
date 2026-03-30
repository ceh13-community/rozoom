/**
 * HPA Effectiveness Score (#10)
 *
 * Evaluates whether HPAs are actually helping:
 * - Are replicas scaling as expected?
 * - Is utilization within target range?
 * - Are conditions healthy?
 */

type GenericItem = Record<string, unknown>;

export type HpaEffectivenessEntry = {
  name: string;
  namespace: string;
  score: number;
  grade: "effective" | "underperforming" | "misconfigured" | "idle";
  currentReplicas: number;
  desiredReplicas: number;
  minReplicas: number;
  maxReplicas: number;
  issues: string[];
};

export type HpaEffectivenessReport = {
  entries: HpaEffectivenessEntry[];
  averageScore: number;
  effectiveCount: number;
  underperformingCount: number;
  misconfiguredCount: number;
  idleCount: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function evaluateHpaEffectiveness(hpas: GenericItem[]): HpaEffectivenessReport {
  const entries: HpaEffectivenessEntry[] = [];

  for (const hpa of hpas) {
    const metadata = asRecord(hpa.metadata);
    const spec = asRecord(hpa.spec);
    const status = asRecord(hpa.status);
    const conditions = asArray(status.conditions);

    const name = asString(metadata.name);
    const namespace = asString(metadata.namespace);
    const current = asNumber(status.currentReplicas);
    const desired = asNumber(status.desiredReplicas);
    const min = asNumber(spec.minReplicas) || 1;
    const max = asNumber(spec.maxReplicas);
    const issues: string[] = [];
    let score = 100;

    // Check conditions
    const scalingActive = conditions.find((c) => asString(asRecord(c).type) === "ScalingActive");
    const ableToScale = conditions.find((c) => asString(asRecord(c).type) === "AbleToScale");

    if (scalingActive && asString(asRecord(scalingActive).status) === "False") {
      score -= 40;
      issues.push(`ScalingActive=False: ${asString(asRecord(scalingActive).reason)}`);
    }
    if (ableToScale && asString(asRecord(ableToScale).status) === "False") {
      score -= 30;
      issues.push(`AbleToScale=False: ${asString(asRecord(ableToScale).reason)}`);
    }

    // Check replica mismatch
    if (desired > 0 && current === 0) {
      score -= 50;
      issues.push("Desired replicas unavailable (current=0)");
    } else if (desired > current) {
      score -= 20;
      issues.push(`Under-scaled: ${current}/${desired} replicas`);
    }

    // Check hitting limits
    if (max > 0 && current >= max) {
      score -= 15;
      issues.push(`At max replicas (${max}) - may need higher limit`);
    }
    if (current <= min && desired > min) {
      score -= 10;
      issues.push(`At min replicas (${min}) but wants more`);
    }

    // Check no metrics configured
    const metrics = asArray(spec.metrics);
    if (metrics.length === 0) {
      score -= 30;
      issues.push("No scaling metrics configured");
    }

    score = Math.max(0, Math.min(100, score));

    let grade: HpaEffectivenessEntry["grade"] = "effective";
    if (issues.length === 0 && current === min && desired <= min) {
      grade = "idle";
    } else if (score < 40) {
      grade = "misconfigured";
    } else if (score < 70) {
      grade = "underperforming";
    }

    entries.push({
      name,
      namespace,
      score,
      grade,
      currentReplicas: current,
      desiredReplicas: desired,
      minReplicas: min,
      maxReplicas: max,
      issues,
    });
  }

  entries.sort((a, b) => a.score - b.score);

  const total = entries.length || 1;
  return {
    entries,
    averageScore: Math.round(entries.reduce((sum, e) => sum + e.score, 0) / total),
    effectiveCount: entries.filter((e) => e.grade === "effective").length,
    underperformingCount: entries.filter((e) => e.grade === "underperforming").length,
    misconfiguredCount: entries.filter((e) => e.grade === "misconfigured").length,
    idleCount: entries.filter((e) => e.grade === "idle").length,
  };
}
