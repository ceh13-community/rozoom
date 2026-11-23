import { describe, it, expect } from "vitest";
import { displayClusterCardState, getColorForClusterCard } from "./card-colors";
import { STATUS_CLASSES } from "../../../entities/cluster/model/constants";
import type { ClusterHealthChecks, ClusterCheckError } from "../model/types";

describe("getColorForClusterCard", () => {
  const baseChecks: ClusterHealthChecks = {
    daemonSets: 0,
    deployments: 10,
    jobs: 0,
    pods: 0,
    replicaSets: 15,
    statefulSets: 0,
    namespaces: ["default", "kube-system"],
    podRestarts: [],
    cronJobs: 5,
    cronJobsHealth: {
      items: [],
      summary: {
        total: 0,
        ok: 0,
        warning: 0,
        critical: 0,
        unknown: 0,
      },
      updatedAt: 0,
    },
    nodes: {
      checks: [],
      summary: {
        count: {
          total: 3,
          ready: 3,
          pressures: {
            memoryPressure: 0,
            diskPressure: 0,
            networkUnavailable: 0,
            pidPressure: 0,
          },
        },
        status: "ok",
        className: "success",
      },
    },
    metricsChecks: {} as any,
    timestamp: Date.now(),
  };

  it("should return unknown, if checks === null", () => {
    const result = getColorForClusterCard(null);

    expect(result).toEqual({
      color: STATUS_CLASSES.unknown,
      text: "Unknown",
    });
  });

  it("should return unknown, if got ClusterCheckError (has 'errors' field)", () => {
    const errorData: ClusterCheckError = {
      errors: "Failed to connect",
      timestamp: Date.now(),
    };

    const result = getColorForClusterCard(errorData);

    expect(result).toEqual({
      color: STATUS_CLASSES.unknown,
      text: "Unknown",
    });
  });

  it("should return unknown, if there are no nodes (or nodes.summary.count has no pressures)", () => {
    const noNodes: ClusterHealthChecks = {
      ...baseChecks,
      nodes: {
        checks: [],
        summary: {
          status: "ok",
          className: "success",
        } as any,
      },
    };

    expect(getColorForClusterCard(noNodes)).toEqual({
      color: STATUS_CLASSES.unknown,
      text: "Unknown",
    });

    const nullNodes = { ...baseChecks, nodes: null };
    expect(getColorForClusterCard(nullNodes as any)).toEqual({
      color: STATUS_CLASSES.unknown,
      text: "Unknown",
    });
  });

  it("should return Critical, if nodes.summary.status === 'Critical'", () => {
    const critical = {
      ...baseChecks,
      nodes: {
        ...baseChecks.nodes!,
        summary: {
          ...baseChecks.nodes!.summary,
          status: "Critical" as const,
        },
      },
    };

    const result = getColorForClusterCard(critical);

    expect(result).toEqual({
      color: STATUS_CLASSES.error,
      text: "Critical",
    });
  });

  it("should return Critical, if pressuresCount > 1", () => {
    const highPressure = {
      ...baseChecks,
      nodes: {
        ...baseChecks.nodes!,
        summary: {
          ...baseChecks.nodes!.summary,
          count: {
            ...baseChecks.nodes!.summary.count,
            pressures: {
              memoryPressure: 1,
              diskPressure: 1,
              networkUnavailable: 0,
              pidPressure: 0,
            },
          },
        },
      },
    };

    const result = getColorForClusterCard(highPressure);

    expect(result).toEqual({
      color: STATUS_CLASSES.error,
      text: "Critical",
    });
  });

  it("should return Warning, if pressuresCount === 1", () => {
    const onePressure = {
      ...baseChecks,
      nodes: {
        ...baseChecks.nodes!,
        summary: {
          ...baseChecks.nodes!.summary,
          count: {
            ...baseChecks.nodes!.summary.count,
            pressures: {
              memoryPressure: 1,
              diskPressure: 0,
              networkUnavailable: 0,
              pidPressure: 0,
            },
          },
        },
      },
    };

    const result = getColorForClusterCard(onePressure);

    expect(result).toEqual({
      color: STATUS_CLASSES.warning,
      text: "Warning",
    });
  });

  it("should return Ok, if pressuresCount === 0 and status is not Critical", () => {
    const healthy = baseChecks;

    const result = getColorForClusterCard(healthy);

    expect(result).toEqual({
      color: STATUS_CLASSES.ok,
      text: "Ok",
    });
  });

  it("should count pressuresCount even if some pressures are missing", () => {
    const partialPressures = {
      ...baseChecks,
      nodes: {
        ...baseChecks.nodes!,
        summary: {
          ...baseChecks.nodes!.summary,
          count: {
            ...baseChecks.nodes!.summary.count,
            pressures: {
              memory: 1,
            } as any,
          },
        },
      },
    };

    const result = getColorForClusterCard(partialPressures);

    expect(result).toEqual({
      color: STATUS_CLASSES.warning,
      text: "Warning",
    });
  });
});

describe("displayClusterCardState", () => {
  const critical = { color: STATUS_CLASSES.error, text: "Critical" };
  const ok = { color: STATUS_CLASSES.ok, text: "Ok" };
  const live = {
    linterOn: true,
    disconnected: false,
    connectivityTitle: "Cluster unreachable",
    connectivityReason: null,
    awaitingInitialRefresh: false,
  };

  it("paints Critical and Ok from the last check, with the matching tooltip", () => {
    expect(displayClusterCardState({ ...live, base: critical })).toEqual({
      ...critical,
      tooltip: "Critical issues detected. Immediate attention recommended.",
    });
    expect(displayClusterCardState({ ...live, base: ok })).toEqual({
      ...ok,
      tooltip: "All health checks passed. Cluster is healthy.",
    });
  });

  it("Paused wins over everything else: the user turned the linter off", () => {
    expect(
      displayClusterCardState({
        ...live,
        linterOn: false,
        disconnected: true,
        awaitingInitialRefresh: true,
        base: critical,
      }),
    ).toMatchObject({ color: "bg-slate-600", text: "Paused" });
  });

  it("a cluster that does not answer is grey with the connectivity title and reason, even before its first check", () => {
    expect(
      displayClusterCardState({
        ...live,
        disconnected: true,
        awaitingInitialRefresh: true,
        connectivityTitle: "Auth expired",
        connectivityReason: "token expired",
        base: critical,
      }),
    ).toEqual({ color: "bg-slate-600", text: "Auth expired", tooltip: "token expired" });
  });

  it("the Warning class carries white text at AA contrast (amber-700, 5.02:1; amber-600 was 3.19:1)", () => {
    expect(STATUS_CLASSES.warning).toContain("bg-amber-700");
    expect(STATUS_CLASSES.warning).not.toContain("amber-600");
  });

  it("a check that has not run yet is Pending, lighter grey", () => {
    expect(
      displayClusterCardState({ ...live, awaitingInitialRefresh: true, base: critical }),
    ).toMatchObject({ color: "bg-slate-500", text: "Pending" });
  });
});
