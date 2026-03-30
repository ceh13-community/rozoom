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
