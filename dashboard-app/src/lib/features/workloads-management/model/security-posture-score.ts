/**
 * Security Posture Score
 *
 * Single 0-100 number combining signals from:
 * - Cluster Score (config hygiene)
 * - Health Score (runtime health)
 * - RBAC risk (wildcard/cluster-admin bindings)
 * - Secret rotation (stale secrets)
 * - Network isolation (missing policies)
 * - Pod security (PSA violations)
 */

export type PostureCategory =
  | "clusterScore"
  | "healthScore"
  | "rbacRisk"
  | "secretRotation"
  | "networkIsolation"
  | "podSecurity";

export type PostureSignal = {
  category: PostureCategory;
  label: string;
  score: number;
  maxScore: number;
  weight: number;
  details: string;
};

export type SecurityPostureResult = {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  gradeLabel: string;
  signals: PostureSignal[];
  topRisks: string[];
};

export type PostureInput = {
  clusterScore?: number | null;
  healthScore?: number | null;
  rbacRiskScore?: number;
  secretRotationScore?: number;
  networkIsolationScore?: number;
  podSecurityScore?: number;
};

function grade(score: number): SecurityPostureResult["grade"] {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

function gradeLabel(g: SecurityPostureResult["grade"]): string {
  const labels = { A: "Excellent", B: "Good", C: "Fair", D: "Poor", F: "Critical" };
  return labels[g];
}

export function computeSecurityPosture(input: PostureInput): SecurityPostureResult {
  const signals: PostureSignal[] = [];

  // Cluster Score: config hygiene (max 100, weight 25%)
  if (input.clusterScore != null) {
    signals.push({
      category: "clusterScore",
      label: "Configuration hygiene",
      score: input.clusterScore,
      maxScore: 100,
      weight: 25,
      details:
        input.clusterScore >= 80
          ? "Configuration checks passing"
          : `Config issues detected (${100 - input.clusterScore} penalty points)`,
    });
  }

  // Health Score: runtime health (max 100, weight 20%)
  if (input.healthScore != null) {
    signals.push({
      category: "healthScore",
      label: "Runtime health",
      score: input.healthScore,
      maxScore: 100,
      weight: 20,
      details:
        input.healthScore >= 80
          ? "Cluster runtime healthy"
          : `Runtime degradation detected (score: ${input.healthScore})`,
    });
  }

  // RBAC risk (inverted: 0 risk = 100 score, >500 risk = 0 score)
  if (input.rbacRiskScore != null) {
    const rbacScore = Math.max(0, 100 - Math.min(100, input.rbacRiskScore / 5));
    signals.push({
      category: "rbacRisk",
      label: "RBAC least-privilege",
      score: Math.round(rbacScore),
      maxScore: 100,
      weight: 20,
      details:
        rbacScore >= 80
          ? "RBAC bindings follow least-privilege"
          : `RBAC risk score: ${input.rbacRiskScore} (wildcard/cluster-admin/secrets access)`,
    });
  }

  // Secret rotation (direct score 0-100, weight 15%)
  if (input.secretRotationScore != null) {
    signals.push({
      category: "secretRotation",
      label: "Secret freshness",
      score: input.secretRotationScore,
      maxScore: 100,
      weight: 15,
      details:
        input.secretRotationScore >= 80
          ? "Secrets regularly rotated"
          : `${100 - input.secretRotationScore}% of secrets aging or stale`,
    });
  }

  // Network isolation (direct score 0-100, weight 10%)
  if (input.networkIsolationScore != null) {
    signals.push({
      category: "networkIsolation",
      label: "Network isolation",
      score: input.networkIsolationScore,
      maxScore: 100,
      weight: 10,
      details:
        input.networkIsolationScore >= 80
          ? "Network policies in place"
          : "Namespaces without default-deny policies detected",
    });
  }

  // Pod security (direct score 0-100, weight 10%)
  if (input.podSecurityScore != null) {
    signals.push({
      category: "podSecurity",
      label: "Pod security standards",
      score: input.podSecurityScore,
      maxScore: 100,
      weight: 10,
      details:
        input.podSecurityScore >= 80
          ? "Pods follow security best practices"
          : "Privileged or non-compliant pods detected",
    });
  }

  // Weighted average
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const weightedSum = signals.reduce((sum, s) => sum + s.score * s.weight, 0);
  const finalScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

  // Top risks
  const topRisks = signals
    .filter((s) => s.score < 70)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((s) => s.details);

  const g = grade(finalScore);
  return {
    score: finalScore,
    grade: g,
    gradeLabel: gradeLabel(g),
    signals,
    topRisks,
  };
}
