import { describe, it, expect } from "vitest";
import { buildClusterHealthScore } from "./cluster-health-score";
import type { ClusterHealthChecks } from "./types";

const baseHealthChecks = (): ClusterHealthChecks => ({
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
  apiServerHealth: {
    live: { ok: true, output: "" },
    ready: { ok: true, output: "" },
    status: "ok",
    updatedAt: 0,
  },
  nodes: {
    checks: [],
    summary: {
      className: "healthy",
      status: "ok",
      count: {
        ready: 3,
        total: 3,
        pressures: {
          diskPressure: 0,
          memoryPressure: 0,
          pidPressure: 0,
          networkUnavailable: 0,
        },
      },
    },
  },
  metricsChecks: {
    endpoints: {
      "metrics-server": {
        installed: true,
        lastSync: "",
        status: "ok",
        title: "metrics-server",
      },
      "kube-state-metrics": {
        installed: true,
        lastSync: "",
        status: "ok",
        title: "kube-state-metrics",
      },
      "node-exporter": {
        installed: true,
        lastSync: "",
        status: "ok",
        title: "node-exporter",
      },
    },
  },
  timestamp: 0,
});

describe("buildClusterHealthScore", () => {
  it("returns a healthy score when no degradations are present", () => {
    const summary = buildClusterHealthScore(baseHealthChecks());

    expect(summary.score).toBe(100);
    expect(summary.status).toBe("healthy");
    expect(summary.risks).toHaveLength(0);
  });

  it("penalizes critical API health failures", () => {
    const checks = baseHealthChecks();
    checks.apiServerHealth = {
      live: { ok: false, output: "" },
      ready: { ok: false, output: "" },
      status: "critical",
      updatedAt: 0,
    };

    const summary = buildClusterHealthScore(checks);

    expect(summary.score).toBe(80);
    expect(summary.status).toBe("degraded");
    expect(summary.risks.some((risk) => risk.id === "api-health")).toBe(true);
  });

  it("does not flag metrics-server when endpoint key uses underscore and is healthy", () => {
    const checks = baseHealthChecks();
    checks.metricsChecks.endpoints = {
      metrics_server: {
        installed: true,
        lastSync: "",
        status: "ok",
        title: "Metrics Server",
      },
    };

    const summary = buildClusterHealthScore(checks);

    expect(summary.risks.some((risk) => risk.id === "metrics-server")).toBe(false);
  });

  it("labels degraded metrics-server as unavailable rather than missing", () => {
    const checks = baseHealthChecks();
    checks.metricsChecks.endpoints = {
      metrics_server: {
        installed: false,
        error: "metrics-server deployment not found",
        lastSync: "",
        status: "not found",
        title: "Metrics Server",
      },
    };

    const summary = buildClusterHealthScore(checks);
    const risk = summary.risks.find((item) => item.id === "metrics-server");

    expect(risk?.title).toBe("metrics-server unavailable");
  });
});
