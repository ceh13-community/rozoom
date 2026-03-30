import { describe, expect, it } from "vitest";
import { buildResourceHeatmap, parseCpuToMillicores, parseMemoryToMiB } from "./resource-heatmap";

describe("resource-heatmap", () => {
  describe("parseCpuToMillicores", () => {
    it("parses millicores", () => expect(parseCpuToMillicores("250m")).toBe(250));
    it("parses cores", () => expect(parseCpuToMillicores("1")).toBe(1000));
    it("parses fractional cores", () => expect(parseCpuToMillicores("0.5")).toBe(500));
    it("parses nanocores", () => expect(parseCpuToMillicores("500000000n")).toBe(500));
    it("returns 0 for null", () => expect(parseCpuToMillicores(null)).toBe(0));
    it("returns 0 for empty", () => expect(parseCpuToMillicores("")).toBe(0));
  });

  describe("parseMemoryToMiB", () => {
    it("parses Mi", () => expect(parseMemoryToMiB("512Mi")).toBe(512));
    it("parses Gi", () => expect(parseMemoryToMiB("2Gi")).toBe(2048));
    it("parses Ki", () => expect(parseMemoryToMiB("1024Ki")).toBe(1));
    it("parses Ti", () => expect(parseMemoryToMiB("1Ti")).toBe(1048576));
    it("returns 0 for null", () => expect(parseMemoryToMiB(null)).toBe(0));
  });

  describe("buildResourceHeatmap", () => {
    it("builds heatmap from pod metrics", () => {
      const report = buildResourceHeatmap([
        {
          namespace: "prod",
          workload: "web",
          workloadType: "Deployment",
          cpuRequestMillicores: 500,
          cpuUsageMillicores: 250,
          memoryRequestMiB: 512,
          memoryUsageMiB: 300,
        },
        {
          namespace: "prod",
          workload: "web",
          workloadType: "Deployment",
          cpuRequestMillicores: 500,
          cpuUsageMillicores: 300,
          memoryRequestMiB: 512,
          memoryUsageMiB: 280,
        },
        {
          namespace: "prod",
          workload: "api",
          workloadType: "Deployment",
          cpuRequestMillicores: 200,
          cpuUsageMillicores: 180,
          memoryRequestMiB: 256,
          memoryUsageMiB: 240,
        },
      ]);

      expect(report.entries).toHaveLength(2);
      expect(report.summary.totalCpuRequested).toBe(1200);
      expect(report.summary.totalCpuUsed).toBe(730);
    });

    it("grades over-provisioned workloads", () => {
      const report = buildResourceHeatmap([
        {
          namespace: "dev",
          workload: "idle-svc",
          workloadType: "Deployment",
          cpuRequestMillicores: 1000,
          cpuUsageMillicores: 50,
          memoryRequestMiB: 1024,
          memoryUsageMiB: 50,
        },
      ]);

      expect(report.entries[0]?.grade).toBe("over-provisioned");
      expect(report.entries[0]?.cpuEfficiency).toBe(5);
    });

    it("grades under-provisioned workloads", () => {
      const report = buildResourceHeatmap([
        {
          namespace: "prod",
          workload: "hot-svc",
          workloadType: "Deployment",
          cpuRequestMillicores: 100,
          cpuUsageMillicores: 500,
          memoryRequestMiB: 128,
          memoryUsageMiB: 800,
        },
      ]);

      expect(report.entries[0]?.grade).toBe("under-provisioned");
    });

    it("grades no-requests workloads", () => {
      const report = buildResourceHeatmap([
        {
          namespace: "dev",
          workload: "no-req",
          workloadType: "Deployment",
          cpuRequestMillicores: 0,
          cpuUsageMillicores: 100,
          memoryRequestMiB: 0,
          memoryUsageMiB: 200,
        },
      ]);

      expect(report.entries[0]?.grade).toBe("no-requests");
      expect(report.summary.noRequestsCount).toBe(1);
    });

    it("grades idle workloads", () => {
      const report = buildResourceHeatmap([
        {
          namespace: "dev",
          workload: "paused",
          workloadType: "Deployment",
          cpuRequestMillicores: 500,
          cpuUsageMillicores: 0,
          memoryRequestMiB: 512,
          memoryUsageMiB: 0,
        },
      ]);

      expect(report.entries[0]?.grade).toBe("idle");
      expect(report.summary.idleCount).toBe(1);
    });

    it("handles empty input", () => {
      const report = buildResourceHeatmap([]);
      expect(report.entries).toHaveLength(0);
      expect(report.summary.avgCpuEfficiency).toBe(0);
    });

    it("aggregates pods per workload", () => {
      const report = buildResourceHeatmap([
        {
          namespace: "ns",
          workload: "w",
          workloadType: "Deployment",
          cpuRequestMillicores: 100,
          cpuUsageMillicores: 50,
          memoryRequestMiB: 128,
          memoryUsageMiB: 64,
        },
        {
          namespace: "ns",
          workload: "w",
          workloadType: "Deployment",
          cpuRequestMillicores: 100,
          cpuUsageMillicores: 50,
          memoryRequestMiB: 128,
          memoryUsageMiB: 64,
        },
      ]);

      expect(report.entries).toHaveLength(1);
      expect(report.entries[0]?.cpuRequestMillicores).toBe(200);
      expect(report.entries[0]?.cpuUsageMillicores).toBe(100);
    });
  });
});
