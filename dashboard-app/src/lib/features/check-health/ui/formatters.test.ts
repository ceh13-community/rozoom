import { describe, it, expect } from "vitest";
import {
  sortedMetricsEndpoints,
  getContainerReason,
  getContainerStatus,
  countPressuresByNodeStatus,
} from "./formatters";
import type { CheckMetricResult, ClusterHealthChecks, PodRestart } from "../model/types";

describe("formatters.ts", () => {
  describe("sortedMetricsEndpoints", () => {
    it("should sort keys alphabetically", () => {
      const unsorted = {
        zzza: { success: true, lastSync: "2025-12-11T10:00:00.000Z", status: "", title: "" },
        aaaa: { success: false, lastSync: "2025-12-11T10:00:00.000Z", status: "", title: "" },
        bbbb: { success: true, lastSync: "2025-12-11T10:00:00.000Z", status: "", title: "" },
      } as Record<string, CheckMetricResult>;

      const result = sortedMetricsEndpoints(unsorted);

      expect(Object.keys(result)).toEqual(["aaaa", "bbbb", "zzza"]);
      expect(result).toEqual({
        aaaa: { success: false, lastSync: "2025-12-11T10:00:00.000Z", status: "", title: "" },
        bbbb: { success: true, lastSync: "2025-12-11T10:00:00.000Z", status: "", title: "" },
        zzza: { success: true, lastSync: "2025-12-11T10:00:00.000Z", status: "", title: "" },
      });
    });

    it("should return empty object, if input is empty", () => {
      expect(sortedMetricsEndpoints({})).toEqual({});
    });
  });

  describe("getContainerReason", () => {
    it("should return reason with terminated, if terminated exists", () => {
      const pod = {
        state: {
          terminated: { reason: "OOMKilled", exitCode: 137, message: "" },
        },
      } as any;

      expect(getContainerReason(pod)).toBe("OOMKilled");
    });

    it("should return reason with waiting, if terminated does not exist", () => {
      const pod = {
        state: {
          waiting: { reason: "ImagePullBackOff", message: "pulling..." },
        },
      } as any;

      expect(getContainerReason(pod)).toBe("ImagePullBackOff");
    });

    it("should return '-', if not terminated neither waiting", () => {
      const pod = {
        state: { running: { startedAt: "2025-01-01" } },
      } as any;

      expect(getContainerReason(pod)).toBe("-");
    });

    it("sgould return '-', if state is empty", () => {
      const pod = { state: {} } as any;
      expect(getContainerReason(pod)).toBe("-");
    });
  });

  describe("getContainerStatus", () => {
    it("should return ⚠️Critical if CrashLoopBackOff", () => {
      const pod = {
        state: { waiting: { reason: "CrashLoopBackOff", message: "" } },
        restartCount: 5,
      } as any;

      expect(getContainerStatus(pod)).toBe("⚠️Critical");
    });

    it("should returnє ❌Terminated, if terminated", () => {
      const pod = {
        state: { terminated: { reason: "Error", exitCode: 1, message: "" } },
      } as any;

      expect(getContainerStatus(pod)).toBe("❌Terminated");
    });

    it("should return 🔃Restarted, if restartCount > 0 and no terminated/waiting with CrashLoop", () => {
      const pod = {
        state: { running: { startedAt: "2025-01-01" } },
        restartCount: 3,
      } as any;

      expect(getContainerStatus(pod)).toBe("🔃Restarted");
    });

    it("should return 🏃Running, if running and restartCount === 0", () => {
      const pod = {
        state: { running: { startedAt: "2025-01-01" } },
        restartCount: 0,
      } as any;

      expect(getContainerStatus(pod)).toBe("🏃Running");
    });

    it("should return '-', if no state satisfies", () => {
      const pod = {
        state: {},
        restartCount: 0,
      } as any;

      expect(getContainerStatus(pod)).toBe("-");
    });
  });

  describe("countPressuresByNodeStatus", () => {
    const baseChecks: ClusterHealthChecks = {
      daemonSets: 0,
      deployments: 0,
      jobs: 0,
      pods: 0,
      replicaSets: 0,
      statefulSets: 0,
      namespaces: [],
      podRestarts: [],
      cronJobs: 0,
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
              memoryPressure: 1,
              diskPressure: 2,
              networkUnavailable: 0,
              pidPressure: 1,
            },
          },
          status: "ok",
          className: "success",
        },
      },
      metricsChecks: {} as any,
      timestamp: 0,
    };

    it("should count sum of all nodes pressures", () => {
      expect(countPressuresByNodeStatus(baseChecks)).toBe(1 + 2 + 0 + 1);
    });

    it("should return 0, if pressures are empty", () => {
      const noPressures = {
        ...baseChecks,
        nodes: {
          ...baseChecks.nodes!,
          summary: {
            ...baseChecks.nodes!.summary,
            count: {
              ...baseChecks.nodes!.summary.count,
              pressures: {},
            },
          },
        },
      };

      expect(countPressuresByNodeStatus(noPressures as ClusterHealthChecks)).toBe(0);
    });

    it("should return 0, if nodes === null or pressures === undefined", () => {
      expect(countPressuresByNodeStatus({ ...baseChecks, nodes: null } as any)).toBe(0);

      const noPressuresField = {
        ...baseChecks,
        nodes: {
          ...baseChecks.nodes!,
          summary: {
            ...baseChecks.nodes!.summary,
            count: {
              ...baseChecks.nodes!.summary.count,
              pressures: undefined as any,
            },
          },
        },
      };

      expect(countPressuresByNodeStatus(noPressuresField)).toBe(0);
    });

    it("should return 0, if checks === null", () => {
      expect(countPressuresByNodeStatus(null)).toBe(0);
    });
  });
});
