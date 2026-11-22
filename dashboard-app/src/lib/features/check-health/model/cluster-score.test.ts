import { describe, it, expect } from "vitest";
import { buildClusterScore } from "./cluster-score";
import type { ClusterHealthChecks, ResourcesHygieneReport, SecretsHygieneReport } from "./types";

const baseChecks = (): ClusterHealthChecks => ({
  daemonSets: 0,
  deployments: 0,
  jobs: 0,
  replicaSets: 0,
  pods: 0,
  statefulSets: 0,
  namespaces: [],
  podRestarts: [],
  cronJobs: 0,
  cronJobsHealth: {
    items: [],
    summary: { total: 0, ok: 0, warning: 0, critical: 0, unknown: 0 },
    updatedAt: 0,
  },
  nodes: {
    checks: [],
    summary: {
      className: "healthy",
      status: "ok",
      count: {
        ready: 1,
        total: 1,
        pressures: {
          diskPressure: 0,
          memoryPressure: 0,
          pidPressure: 0,
          networkUnavailable: 0,
        },
      },
    },
  },
  metricsChecks: { endpoints: {} },
  timestamp: 0,
});

describe("buildClusterScore", () => {
  it("returns unknown when checks are missing", () => {
    const summary = buildClusterScore(null);

    expect(summary.score).toBeNull();
    expect(summary.status).toBe("unknown");
  });

  it("adds risks when hygiene issues are present", () => {
    const checks = baseChecks();
    checks.resourcesHygiene = {
      status: "warning",
      summary: {
        status: "warning",
        message: "",
        total: 1,
        ok: 0,
        warning: 0,
        critical: 3,
        bestEffort: 0,
        updatedAt: 0,
      },
      workloads: [],
      items: [
        {
          namespace: "default",
          workload: "api",
          workloadType: "Deployment",
          container: "api",
          missing: ["cpu request", "memory request"],
          optionalMissing: [],
          qosClass: "Burstable",
        },
      ],
      updatedAt: 0,
    } satisfies ResourcesHygieneReport;

    checks.secretsHygiene = {
      status: "critical",
      summary: {
        status: "critical",
        message: "",
        total: 1,
        ok: 0,
        warning: 0,
        critical: 1,
        updatedAt: 0,
      },
      items: [
        {
          namespace: "default",
          configMap: "app-config",
          key: "token",
          status: "critical",
          issues: ["appears to contain a secret"],
          recommendations: ["Move to a Secret resource"],
        },
      ],
      encryptionStatus: "unknown",
      updatedAt: 0,
    } satisfies SecretsHygieneReport;

    const summary = buildClusterScore(checks);

    expect(summary.score).toBeLessThan(100);
    expect(summary.risks.length).toBeGreaterThan(0);
    expect(summary.risks.some((risk) => risk.id === "resources-missing")).toBe(true);
    expect(summary.risks.some((risk) => risk.id === "secrets")).toBe(true);
  });
});

const RULE_IDS = [
  "resources-missing",
  "best-effort",
  "hpa-health",
  "hpa-no-requests",
  "vpa-hpa-conflict",
  "image-latest",
  "probes",
  "topology",
  "pdb",
  "psa",
  "security-hardening",
  "network-policy",
  "secrets",
  "priority",
  "rbac-overprivileged",
  "ingress-no-tls",
];

const ingressReport = (items: Array<{ namespace: string; name: string; hasTls: boolean }>) => {
  const withoutTls = items.filter((item) => !item.hasTls).length;
  return {
    status: withoutTls > 0 ? ("warning" as const) : ("ok" as const),
    summary: {
      status: withoutTls > 0 ? "warning" : "ok",
      message: "",
      total: items.length,
      withTls: items.length - withoutTls,
      withoutTls,
      updatedAt: 0,
    },
    items: items.map((item) => ({ ...item, hosts: "" })),
    updatedAt: 0,
  };
};

describe("buildClusterScore rules", () => {
  it("lists every rule as not checked when health checks are missing", () => {
    const summary = buildClusterScore(null);

    expect(summary.rules.map((rule) => rule.id)).toEqual(RULE_IDS);
    expect(summary.rules.every((rule) => rule.status === "unknown")).toBe(true);
    expect(summary.rules.every((rule) => rule.statusLabel === "Not checked")).toBe(true);
    expect(summary.rules.every((rule) => rule.penalty === 0)).toBe(true);
  });

  it("keeps the rule order and marks rules without a report as not checked", () => {
    const summary = buildClusterScore(baseChecks());

    expect(summary.rules.map((rule) => rule.id)).toEqual(RULE_IDS);
    expect(summary.rules.every((rule) => rule.status === "unknown")).toBe(true);
    expect(summary.risks).toEqual([]);
  });

  it("marks a rule OK when its report ran and found nothing", () => {
    const checks = baseChecks();
    checks.ingressStatus = ingressReport([{ namespace: "web", name: "shop", hasTls: true }]);

    const rule = buildClusterScore(checks).rules.find((item) => item.id === "ingress-no-tls");

    expect(rule?.status).toBe("ok");
    expect(rule?.statusLabel).toBe("OK");
    expect(rule?.title).toBe("Ingress without TLS");
    expect(rule?.references).toEqual([]);
    expect(rule?.penalty).toBe(0);
  });

  it("marks a rule not checked when its report could not run", () => {
    const checks = baseChecks();
    checks.ingressStatus = { ...ingressReport([]), status: "unknown" };

    const rule = buildClusterScore(checks).rules.find((item) => item.id === "ingress-no-tls");

    expect(rule?.status).toBe("unknown");
  });

  it("points a fired rule at the objects it found", () => {
    const checks = baseChecks();
    checks.ingressStatus = ingressReport([
      { namespace: "dem-lint", name: "plain-http", hasTls: false },
      { namespace: "web", name: "shop", hasTls: true },
    ]);
    checks.podQos = {
      status: "critical",
      summary: {
        status: "critical",
        message: "",
        total: 2,
        ok: 1,
        warning: 0,
        critical: 1,
        bestEffort: 1,
        updatedAt: 0,
      },
      items: [
        {
          namespace: "dem-lint",
          pod: "noreq-7d9f",
          workload: "noreq",
          workloadType: "Deployment",
          qosClass: "BestEffort",
          status: "critical",
          missing: ["cpu request"],
          recommendedQos: "Burstable",
          recommendation: "",
          sampleConfig: "",
        },
        {
          namespace: "web",
          pod: "shop-1",
          workload: "shop",
          workloadType: "Deployment",
          qosClass: "Burstable",
          status: "ok",
          missing: [],
          recommendedQos: "Burstable",
          recommendation: "",
          sampleConfig: "",
        },
      ],
      updatedAt: 0,
    };

    const summary = buildClusterScore(checks);
    const ingress = summary.rules.find((item) => item.id === "ingress-no-tls");
    const bestEffort = summary.rules.find((item) => item.id === "best-effort");

    expect(ingress?.status).toBe("warning");
    expect(ingress?.statusLabel).toBe("Warning");
    expect(ingress?.title).toBe("Ingress without TLS (1)");
    expect(ingress?.references).toEqual(["dem-lint/plain-http"]);
    expect(ingress?.penalty).toBeGreaterThan(0);

    expect(bestEffort?.status).toBe("critical");
    expect(bestEffort?.title).toBe("BestEffort pods (1)");
    expect(bestEffort?.references).toEqual(["dem-lint/noreq-7d9f"]);
  });

  it("derives risks from the fired rules only", () => {
    const checks = baseChecks();
    checks.ingressStatus = ingressReport([
      { namespace: "dem-lint", name: "plain-http", hasTls: false },
    ]);

    const summary = buildClusterScore(checks);
    const fired = summary.rules.filter(
      (rule) => rule.status === "warning" || rule.status === "critical",
    );

    expect(summary.risks.map((risk) => risk.id)).toEqual(fired.map((rule) => rule.id));
    expect(summary.risks[0]?.references).toEqual(["dem-lint/plain-http"]);
    expect(summary.score).toBe(100 - summary.risks[0].penalty);
  });
});
