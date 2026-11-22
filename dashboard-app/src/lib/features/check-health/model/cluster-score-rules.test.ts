import { describe, expect, it } from "vitest";
import { buildClusterScore, CLUSTER_SCORE_RULES } from "./cluster-score";
import type { ClusterHealthChecks } from "./types";

// Reports are partial on purpose: the rule list reads status, summary counts and items only.
const report = <T>(value: unknown) => value as T;

const baseChecks = (): ClusterHealthChecks =>
  ({
    daemonSets: 0,
    deployments: 0,
    jobs: 0,
    replicaSets: 0,
    pods: 0,
    statefulSets: 0,
    namespaces: [],
    podRestarts: [],
    cronJobs: 0,
    metricsChecks: { endpoints: {} },
    timestamp: 0,
  }) as unknown as ClusterHealthChecks;

const summary = (critical: number, warning: number, extra: Record<string, unknown> = {}) => ({
  status: critical ? "critical" : warning ? "warning" : "ok",
  message: "",
  total: critical + warning + 1,
  ok: 1,
  warning,
  critical,
  updatedAt: 0,
  ...extra,
});

// One failing object per rule, plus an ok object that must not be named.
const failingChecks = (): ClusterHealthChecks => {
  const checks = baseChecks();
  checks.resourcesHygiene = report({
    status: "critical",
    summary: summary(1, 0, { bestEffort: 1 }),
    workloads: [
      {
        namespace: "lint",
        workload: "app",
        workloadType: "Deployment",
        status: "critical",
        qosClass: "BestEffort",
        missing: ["cpu request", "memory request"],
        optionalMissing: [],
      },
      // Status ok: only the optional CPU limit is missing, yet the check lists its container.
      {
        namespace: "lint",
        workload: "fine",
        workloadType: "Deployment",
        status: "ok",
        qosClass: "Burstable",
        missing: [],
        optionalMissing: ["cpu limit"],
      },
    ],
    items: [
      {
        namespace: "lint",
        workload: "app",
        workloadType: "Deployment",
        container: "app",
        missing: ["cpu request", "memory request"],
        optionalMissing: [],
        qosClass: "BestEffort",
      },
      {
        namespace: "lint",
        workload: "fine",
        workloadType: "Deployment",
        container: "fine",
        missing: [],
        optionalMissing: ["cpu limit"],
        qosClass: "Burstable",
      },
    ],
    updatedAt: 0,
  });
  checks.podQos = report({
    status: "critical",
    summary: summary(1, 0, { bestEffort: 1 }),
    items: [
      { namespace: "lint", pod: "app-1", qosClass: "BestEffort", status: "critical" },
      { namespace: "lint", pod: "fine-1", qosClass: "Burstable", status: "ok" },
    ],
    updatedAt: 0,
  });
  checks.hpaStatus = report({
    status: "warning",
    summary: summary(0, 1),
    items: [
      { namespace: "lint", workload: "app", workloadType: "Deployment", status: "warning" },
      { namespace: "lint", workload: "fine", workloadType: "Deployment", status: "ok" },
    ],
    updatedAt: 0,
  });
  checks.vpaStatus = report({
    status: "warning",
    summary: summary(0, 1),
    items: [{ namespace: "lint", workload: "app", updateMode: "Auto", hpaPresent: true }],
    updatedAt: 0,
  });
  (checks as Record<string, unknown>).imageFreshness = {
    status: "warning",
    summary: { totalContainers: 2, latestTagCount: 1, noDigestCount: 2 },
    updatedAt: 0,
  };
  checks.probesHealth = report({
    status: "critical",
    summary: summary(1, 0),
    items: [
      { namespace: "lint", workload: "app", status: "critical" },
      { namespace: "lint", workload: "fine", status: "ok" },
    ],
    updatedAt: 0,
  });
  checks.topologyHa = report({
    status: "warning",
    summary: summary(0, 1),
    items: [
      { namespace: "lint", workload: "app", replicas: 2, status: "warning" },
      { namespace: "lint", workload: "fine", replicas: 2, status: "ok" },
    ],
    updatedAt: 0,
  });
  checks.pdbStatus = report({
    status: "critical",
    summary: summary(1, 0),
    items: [
      { namespace: "lint", workload: "critical", replicas: 2, status: "critical" },
      { namespace: "lint", workload: "fine", replicas: 2, status: "ok" },
    ],
    updatedAt: 0,
  });
  checks.podSecurity = report({
    status: "critical",
    summary: summary(1, 0),
    namespaces: [],
    items: [
      { namespace: "lint", pod: "pod", container: "a", status: "critical" },
      { namespace: "lint", pod: "pod", container: "b", status: "critical" },
      { namespace: "lint", pod: "fine", container: "a", status: "ok" },
    ],
    updatedAt: 0,
  });
  checks.securityHardening = report({
    status: "warning",
    summary: summary(0, 1),
    items: [
      { namespace: "lint", workload: "app", workloadType: "Deployment", status: "warning" },
      { namespace: "lint", workload: "fine", workloadType: "Deployment", status: "ok" },
    ],
    updatedAt: 0,
  });
  checks.networkIsolation = report({
    status: "critical",
    summary: summary(1, 0),
    items: [
      { namespace: "lint", status: "critical" },
      { namespace: "fine", status: "ok" },
    ],
    updatedAt: 0,
  });
  checks.secretsHygiene = report({
    status: "critical",
    summary: summary(1, 0),
    items: [{ namespace: "lint", configMap: "config", key: "api_key", status: "critical" }],
    updatedAt: 0,
  });
  checks.priorityStatus = report({
    status: "warning",
    summary: summary(0, 1),
    items: [
      { namespace: "lint", workload: "critical", status: "warning" },
      { namespace: "lint", workload: "fine", status: "ok" },
    ],
    updatedAt: 0,
  });
  (checks as Record<string, unknown>).rbacOverview = {
    status: "warning",
    summary: { overprivilegedCount: 1 },
    updatedAt: 0,
  };
  (checks as Record<string, unknown>).ingressStatus = {
    status: "warning",
    summary: { total: 2, withTls: 1, withoutTls: 1 },
    items: [
      { namespace: "lint", name: "plain", hosts: "a", hasTls: false },
      { namespace: "lint", name: "tls", hosts: "b", hasTls: true },
    ],
    updatedAt: 0,
  };
  return checks;
};

// The same reports with nothing flagged.
const passingChecks = (): ClusterHealthChecks => {
  const checks = baseChecks();
  const clean = {
    status: "ok",
    summary: summary(0, 0, { bestEffort: 0 }),
    items: [],
    updatedAt: 0,
  };
  checks.resourcesHygiene = report({ ...clean, workloads: [] });
  checks.podQos = report(clean);
  checks.hpaStatus = report(clean);
  checks.vpaStatus = report(clean);
  checks.probesHealth = report(clean);
  checks.topologyHa = report(clean);
  checks.pdbStatus = report(clean);
  checks.podSecurity = report({ ...clean, namespaces: [] });
  checks.securityHardening = report(clean);
  checks.networkIsolation = report(clean);
  checks.secretsHygiene = report(clean);
  checks.priorityStatus = report(clean);
  Object.assign(checks, {
    imageFreshness: { status: "ok", summary: { latestTagCount: 0 }, updatedAt: 0 },
    rbacOverview: { status: "ok", summary: { overprivilegedCount: 0 }, updatedAt: 0 },
    ingressStatus: { status: "ok", summary: { withoutTls: 0 }, items: [], updatedAt: 0 },
  });
  return checks;
};

const byId = (checks: ClusterHealthChecks | null) =>
  Object.fromEntries(buildClusterScore(checks).rules.map((rule) => [rule.id, rule]));

describe("cluster score rule list", () => {
  it("lists every rule as not checked before any check ran", () => {
    const rules = buildClusterScore(null).rules;
    expect(rules.map((rule) => rule.id)).toEqual(CLUSTER_SCORE_RULES.map((rule) => rule.id));
    expect(rules.every((rule) => rule.status === "not-checked")).toBe(true);
  });

  // A risk id missing from the rule list would count in the score but show nowhere.
  it("has a row for every risk the score can raise", () => {
    const summaryResult = buildClusterScore(failingChecks());
    const ruleIds = new Set<string>(CLUSTER_SCORE_RULES.map((rule) => rule.id));
    expect(summaryResult.risks.map((risk) => risk.id).filter((id) => !ruleIds.has(id))).toEqual([]);
    expect(summaryResult.rules.filter((rule) => rule.status !== "fail")).toEqual([]);
  });

  it("names only the flagged objects, each once", () => {
    const rules = byId(failingChecks());
    const refs = (id: string) => rules[id].risk?.references;
    expect(refs("resources-missing")).toEqual(["lint/Deployment/app"]);
    expect(refs("best-effort")).toEqual(["lint/app-1"]);
    expect(refs("hpa-health")).toEqual(["lint/app"]);
    expect(refs("probes")).toEqual(["lint/app"]);
    expect(refs("topology")).toEqual(["lint/app"]);
    expect(refs("pdb")).toEqual(["lint/critical"]);
    expect(refs("psa")).toEqual(["lint/pod"]);
    expect(refs("security-hardening")).toEqual(["lint/Deployment/app"]);
    expect(refs("network-policy")).toEqual(["lint"]);
    expect(refs("secrets")).toEqual(["lint/config"]);
    expect(refs("priority")).toEqual(["lint/critical"]);
    expect(refs("ingress-no-tls")).toEqual(["lint/plain"]);
    expect(refs("hpa-no-requests")).toEqual(["lint/deployment/app"]);
    expect(refs("vpa-hpa-conflict")).toEqual(["lint/app"]);
    // These checks count objects without naming them.
    expect(refs("image-latest")).toEqual([]);
    expect(refs("rbac-overprivileged")).toEqual([]);
  });

  it("passes a rule only when its check produced a clean report", () => {
    const rules = byId(passingChecks());
    expect(Object.values(rules).filter((rule) => rule.status !== "pass")).toEqual([]);
    expect(buildClusterScore(passingChecks()).score).toBe(100);
  });

  it("does not pass a rule whose check could not read the cluster", () => {
    const checks = passingChecks();
    checks.networkIsolation = report({
      status: "unsupported",
      summary: summary(0, 0),
      items: [],
      updatedAt: 0,
    });
    checks.probesHealth = report({
      status: "insufficient",
      summary: summary(0, 0),
      items: [],
      updatedAt: 0,
    });
    delete (checks as Record<string, unknown>).rbacOverview;
    const rules = byId(checks);
    expect(rules["network-policy"].status).toBe("not-checked");
    expect(rules.probes.status).toBe("not-checked");
    expect(rules["rbac-overprivileged"].status).toBe("not-checked");
    expect(rules.secrets.status).toBe("pass");
  });
});
