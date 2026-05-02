import { describe, expect, it } from "vitest";
import type { ClusterHealthChecks } from "$features/check-health/model/types";
import {
  buildChangeSinceLastCheck,
  buildHealthTimeline,
  buildOverviewSafeActions,
  buildOverviewTopRisks,
  buildPrimaryAlert,
  captureOverviewHealthHistoryEntry,
  humanizeClusterError,
  isAuthError,
  isConnectionError,
} from "./overview-diagnostics";

function makeChecks(overrides?: Partial<ClusterHealthChecks>): ClusterHealthChecks {
  return {
    daemonSets: 1,
    deployments: 2,
    jobs: 1,
    replicaSets: 2,
    pods: 4,
    statefulSets: 1,
    namespaces: ["default"],
    podRestarts: [],
    cronJobs: 1,
    cronJobsHealth: {
      items: [],
      summary: { total: 1, ok: 1, warning: 0, critical: 0, unknown: 0 },
      updatedAt: Date.now(),
    },
    nodes: {
      checks: [],
      summary: {
        className: "ok",
        status: "Ok",
        count: {
          ready: 1,
          total: 1,
          pressures: { diskPressure: 0, memoryPressure: 0, pidPressure: 0, networkUnavailable: 0 },
        },
      },
    },
    metricsChecks: {
      endpoints: {
        kubelet: {
          title: "Kubelet",
          status: "✅ Available",
          lastSync: "now",
        },
      },
    },
    apiServerHealth: {
      status: "ok",
      live: { ok: true, output: "ok" },
      ready: { ok: true, output: "readyz check passed" },
      updatedAt: Date.now(),
    },
    apiServerLatency: {
      status: "ok",
      summary: { status: "ok", message: "", warnings: [], updatedAt: Date.now() },
      overall: { p95: 120 },
      groups: [],
      updatedAt: Date.now(),
    },
    podIssues: {
      status: "warning",
      summary: { status: "warning", warnings: [], updatedAt: Date.now(), message: "issues" },
      items: [],
      crashLoopCount: 1,
      pendingCount: 0,
      totalPods: 4,
      updatedAt: Date.now(),
    },
    apfHealth: {
      status: "ok",
      summary: { status: "ok", warnings: [], updatedAt: Date.now(), message: "ok" },
      metrics: null,
      metricRates: {},
      updatedAt: Date.now(),
    },
    etcdHealth: {
      status: "ok",
      summary: { status: "ok", warnings: [], updatedAt: Date.now() },
      health: [],
      endpointStatus: [],
      metrics: [],
      metricRates: {},
      updatedAt: Date.now(),
    },
    warningEvents: {
      status: "warning",
      summary: { status: "warning", message: "warnings", warnings: [], updatedAt: Date.now() },
      items: [],
      updatedAt: Date.now(),
    },
    certificatesHealth: {
      status: "warning",
      summary: { status: "warning", message: "expiring", warnings: [], updatedAt: Date.now() },
      certificates: [{ name: "apiserver", status: "warning", daysLeft: 12 }],
      kubeletRotation: [],
      updatedAt: Date.now(),
    },
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("overview-diagnostics", () => {
  it("builds top risks and primary alert from cluster health score", () => {
    const checks = makeChecks();
    const risks = buildOverviewTopRisks(checks);
    expect(risks.length).toBeGreaterThan(0);
    expect(risks[0]?.command).toContain("kubectl");
    expect(
      risks.some((risk) => typeof risk.evidence === "string" && risk.evidence.length > 0),
    ).toBe(true);

    expect(buildPrimaryAlert(checks)).toMatchObject({
      severity: "critical",
    });
  });

  it("captures history entries and reports changes since last check", () => {
    const previous = captureOverviewHealthHistoryEntry({
      checks: makeChecks({
        podIssues: {
          status: "ok",
          summary: { status: "ok", warnings: [], updatedAt: Date.now(), message: "ok" },
          items: [],
          crashLoopCount: 0,
          pendingCount: 0,
          totalPods: 4,
          updatedAt: Date.now(),
        },
        apiServerLatency: {
          status: "ok",
          summary: { status: "ok", message: "", warnings: [], updatedAt: Date.now() },
          overall: { p95: 100 },
          groups: [],
          updatedAt: Date.now(),
        },
      }),
      warningItems: [],
      providerIds: ["baremetal://node-1"],
      capturedAt: 1_000,
    });
    const current = captureOverviewHealthHistoryEntry({
      checks: makeChecks({
        apiServerLatency: {
          status: "warning",
          summary: { status: "warning", message: "", warnings: [], updatedAt: Date.now() },
          overall: { p95: 500 },
          groups: [],
          updatedAt: Date.now(),
        },
      }),
      warningItems: [
        {
          timestamp: Date.now(),
          type: "Warning",
          namespace: "default",
          objectKind: "Pod",
          objectName: "api",
          reason: "BackOff",
          message: "boom",
          count: 1,
        },
      ],
      providerIds: ["baremetal://node-1"],
      capturedAt: 2_000,
    });

    const changes = buildChangeSinceLastCheck(current, previous);
    expect(changes.map((item) => item.id)).toContain("crashloops");
    expect(changes.map((item) => item.id)).toContain("api-latency");
  });

  it("builds timeline series and safe actions", () => {
    const first = captureOverviewHealthHistoryEntry({
      checks: makeChecks(),
      warningItems: [],
      providerIds: ["baremetal://node-1"],
      capturedAt: Date.now() - 5_000,
    });
    const second = captureOverviewHealthHistoryEntry({
      checks: makeChecks({
        podIssues: {
          status: "critical",
          summary: { status: "critical", warnings: [], updatedAt: Date.now(), message: "issues" },
          items: [],
          crashLoopCount: 3,
          pendingCount: 1,
          totalPods: 4,
          updatedAt: Date.now(),
        },
      }),
      warningItems: [],
      providerIds: ["baremetal://node-1"],
      capturedAt: Date.now(),
    });

    const timeline = buildHealthTimeline([first!, second!], 60_000, Date.now());
    expect(timeline).toHaveLength(4);
    expect(timeline[1]?.points).toHaveLength(2);

    const actions = buildOverviewSafeActions({ checks: makeChecks(), warningItems: [] });
    expect(actions.some((action) => action.id === "failing-pods")).toBe(true);
    expect(actions.some((action) => action.id === "inspect-kube-system")).toBe(true);
  });

  describe("isAuthError", () => {
    it("flags Rancher-style unauthenticated response", () => {
      expect(
        isAuthError(
          'Error from server (Forbidden): ...User "system:unauthenticated" cannot get resource "clusters"',
        ),
      ).toBe(true);
    });

    it("flags cloud-provider expired token messages", () => {
      expect(isAuthError("error: You must be logged in to the server (Unauthorized)")).toBe(true);
      expect(isAuthError("invalid bearer token")).toBe(true);
      expect(isAuthError("the provided token has expired")).toBe(true);
      expect(isAuthError("expired credentials in kubeconfig")).toBe(true);
    });

    it("flags raw HTTP 401/403 codes", () => {
      expect(isAuthError("server returned status 401")).toBe(true);
      expect(isAuthError("HTTP 403 from API")).toBe(true);
    });

    it("does not flag network-level failures", () => {
      expect(isAuthError("ECONNREFUSED 127.0.0.1:6443")).toBe(false);
      expect(isAuthError("no route to host")).toBe(false);
      expect(isAuthError("getaddrinfo ENOTFOUND")).toBe(false);
      expect(isAuthError("certificate has expired")).toBe(false);
      expect(isAuthError("")).toBe(false);
    });

    it("does not flag digits 401/403 appearing inside other numbers", () => {
      // Log line numbers, byte counts, durations embedding 401/403 should
      // not trigger auth classification. Word boundaries prevent match.
      expect(isAuthError("read 4017 bytes from pipe")).toBe(false);
      expect(isAuthError("stream offset 12403 reached")).toBe(false);
      expect(isAuthError("stderr line 1403: kubectl: ...")).toBe(false);
      expect(isAuthError("duration 4.01s (403ms overhead)")).toBe(false);
    });

    it("does not flag 'exit status 255' inside unrelated context", () => {
      // exit status 255 as a standalone token is an exec-plugin signal.
      expect(isAuthError("plugin exited with exit status 255")).toBe(true);
      // but should not match strings like "status 2554" (the combined suite
      // count showed up in our logs).
      expect(isAuthError("status 2554 ok")).toBe(false);
    });
  });

  describe("isConnectionError includes auth errors", () => {
    it("returns true for both network and auth failures", () => {
      expect(isConnectionError("ECONNREFUSED 127.0.0.1:6443")).toBe(true);
      expect(isConnectionError('User "system:unauthenticated" cannot get resource')).toBe(true);
      expect(isConnectionError("the provided token has expired")).toBe(true);
    });

    it("returns false for generic cluster issues", () => {
      expect(isConnectionError("pod is in CrashLoopBackOff")).toBe(false);
      expect(isConnectionError("")).toBe(false);
    });
  });

  describe("humanizeClusterError", () => {
    it("labels auth errors distinctly", () => {
      expect(humanizeClusterError("HTTP 403 Forbidden").title).toBe("Authentication failed");
      expect(humanizeClusterError("Unauthorized").title).toBe("Authentication failed");
    });

    it("labels network errors distinctly", () => {
      expect(humanizeClusterError("ECONNREFUSED").title).toBe("Cluster unreachable");
      expect(humanizeClusterError("no route to host").title).toBe("Cluster unreachable");
    });

    it("labels HTTP status codes", () => {
      expect(humanizeClusterError("server returned 429 too many requests").title).toBe(
        "API server rate-limited",
      );
      expect(humanizeClusterError("HTTP 503 service unavailable").title).toBe(
        "API server unavailable",
      );
      expect(humanizeClusterError("502 bad gateway from proxy").title).toBe("API gateway error");
      expect(humanizeClusterError("HTTP 500 internal server error").title).toBe("API server error");
    });
  });

  describe("isAuthError exec-plugin patterns", () => {
    it("recognizes AWS EKS authenticator failures", () => {
      expect(isAuthError("aws-iam-authenticator: process-credentials")).toBe(true);
      expect(
        isAuthError("Unable to locate credentials. You can configure credentials by running"),
      ).toBe(true);
      expect(
        isAuthError("The security token included in the request is expired (ExpiredToken)"),
      ).toBe(true);
      expect(isAuthError("SSO session has expired. Run aws sso login")).toBe(true);
    });

    it("recognizes GKE auth plugin failures", () => {
      expect(isAuthError("gke-gcloud-auth-plugin exited with code 1")).toBe(true);
      expect(isAuthError("reauthentication is needed. Run gcloud auth login")).toBe(true);
      expect(isAuthError("Application Default Credentials are not available")).toBe(true);
    });

    it("recognizes Azure/kubelogin failures", () => {
      expect(isAuthError("AADSTS700082: The refresh token has expired due to inactivity")).toBe(
        true,
      );
      expect(isAuthError("kubelogin: no cached token")).toBe(true);
    });

    it("recognizes generic exec-plugin envelopes", () => {
      expect(isAuthError("getting credentials: exec: executable not found")).toBe(true);
      expect(isAuthError("exec plugin: invalid apiVersion")).toBe(true);
    });

    it("recognizes OIDC flows", () => {
      expect(isAuthError("oidc: token is expired")).toBe(true);
      expect(isAuthError("could not find client credentials")).toBe(true);
    });
  });
});
