import { describe, expect, it } from "vitest";
import type { ClusterHealthChecks } from "$features/check-health/model/types";
import {
  buildChangeSinceLastCheck,
  buildHealthTimeline,
  buildOverviewSafeActions,
  buildOverviewTopRisks,
  buildPrimaryAlert,
  captureOverviewHealthHistoryEntry,
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
});
