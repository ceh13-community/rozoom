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

  it("flags metrics-server as unavailable when installed and failing", () => {
    const checks = baseHealthChecks();
    checks.metricsChecks.endpoints = {
      metrics_server: {
        installed: true,
        error: "metrics-server pods in CrashLoopBackOff",
        lastSync: "",
        status: "degraded",
        title: "Metrics Server",
      },
    };

    const summary = buildClusterHealthScore(checks);
    const risk = summary.risks.find((item) => item.id === "metrics-server");

    expect(risk?.title).toBe("metrics-server unavailable");
    expect(risk?.severity).toBe("critical");
  });

  describe("optional observability addons", () => {
    it("does not penalize an EKS-style cluster that never deployed metrics-server", () => {
      const checks = baseHealthChecks();
      checks.metricsChecks.endpoints = {
        metrics_server: {
          installed: false,
          lastSync: "",
          status: "not found",
          title: "Metrics Server",
        },
      };

      const summary = buildClusterHealthScore(checks);

      expect(summary.risks.some((risk) => risk.id === "metrics-server")).toBe(false);
      expect(summary.risks.some((risk) => risk.id === "kube-state-metrics")).toBe(false);
      expect(summary.risks.some((risk) => risk.id === "node-exporter")).toBe(false);
      expect(summary.status).toBe("healthy");
    });

    it("does not penalize a cluster with no metrics endpoints at all", () => {
      const checks = baseHealthChecks();
      checks.metricsChecks.endpoints = {};

      const summary = buildClusterHealthScore(checks);

      expect(summary.risks).toHaveLength(0);
      expect(summary.status).toBe("healthy");
    });

    it("does not penalize absence of kube-state-metrics or node-exporter", () => {
      const checks = baseHealthChecks();
      checks.metricsChecks.endpoints = {
        "metrics-server": {
          installed: true,
          lastSync: "",
          status: "ok",
          title: "metrics-server",
        },
        // kube-state-metrics and node-exporter not deployed
      };

      const summary = buildClusterHealthScore(checks);

      expect(summary.risks.some((risk) => risk.id === "kube-state-metrics")).toBe(false);
      expect(summary.risks.some((risk) => risk.id === "node-exporter")).toBe(false);
    });

    it("still flags kube-state-metrics and node-exporter when installed but degraded", () => {
      const checks = baseHealthChecks();
      checks.metricsChecks.endpoints = {
        "metrics-server": {
          installed: true,
          lastSync: "",
          status: "ok",
          title: "metrics-server",
        },
        "kube-state-metrics": {
          installed: true,
          error: "pod stuck in Pending",
          lastSync: "",
          status: "degraded",
          title: "kube-state-metrics",
        },
        "node-exporter": {
          installed: true,
          error: "DaemonSet has 2/3 ready",
          lastSync: "",
          status: "degraded",
          title: "node-exporter",
        },
      };

      const summary = buildClusterHealthScore(checks);

      const kubeState = summary.risks.find((risk) => risk.id === "kube-state-metrics");
      const nodeExporter = summary.risks.find((risk) => risk.id === "node-exporter");

      expect(kubeState?.severity).toBe("warning");
      expect(kubeState?.title).toBe("kube-state-metrics degraded");
      expect(nodeExporter?.severity).toBe("warning");
      expect(nodeExporter?.title).toBe("node-exporter degraded");
    });

    it("does not penalize EKS-style 'Installed but unreachable' probe failures", () => {
      // Addons are actually running on the cluster (`installed: true`) but
      // the probe cannot reach them through the kube-apiserver service proxy
      // / aggregated metrics.k8s.io API. Treat as probe-layer issue, not a
      // cluster health signal.
      const checks = baseHealthChecks();
      checks.metricsChecks.endpoints = {
        "metrics-server": {
          installed: true,
          error: "dial tcp: i/o timeout",
          lastSync: "",
          status: "🟠 Installed but unreachable",
          title: "metrics-server",
        },
        "kube-state-metrics": {
          installed: true,
          error: "the server could not find the requested resource",
          lastSync: "",
          status: "🟠 Installed but unreachable",
          title: "kube-state-metrics",
        },
        "node-exporter": {
          installed: true,
          error: "Error from server (Forbidden): pods is forbidden",
          lastSync: "",
          status: "🟠 Installed but unreachable",
          title: "node-exporter",
        },
      };

      const summary = buildClusterHealthScore(checks);

      expect(summary.risks.some((risk) => risk.id === "metrics-server")).toBe(false);
      expect(summary.risks.some((risk) => risk.id === "kube-state-metrics")).toBe(false);
      expect(summary.risks.some((risk) => risk.id === "node-exporter")).toBe(false);
      expect(summary.status).toBe("healthy");
    });
  });
});
