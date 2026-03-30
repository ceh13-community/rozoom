import { describe, expect, it } from "vitest";
import { buildNodeCapacityReport } from "./node-capacity";

describe("node-capacity", () => {
  it("builds capacity report for nodes", () => {
    const report = buildNodeCapacityReport([
      {
        name: "node-1",
        allocatableCpuMillicores: 4000,
        allocatableMemoryMiB: 8192,
        requestedCpuMillicores: 2000,
        requestedMemoryMiB: 4096,
        usedCpuMillicores: 1500,
        usedMemoryMiB: 3000,
      },
      {
        name: "node-2",
        allocatableCpuMillicores: 4000,
        allocatableMemoryMiB: 8192,
        requestedCpuMillicores: 3500,
        requestedMemoryMiB: 7000,
        usedCpuMillicores: 3000,
        usedMemoryMiB: 6000,
      },
    ]);

    expect(report.nodes).toHaveLength(2);
    expect(report.nodes[0]?.headroomCpuMillicores).toBe(2000);
    expect(report.nodes[1]?.headroomCpuMillicores).toBe(500);
    expect(report.totals.allocatableCpu).toBe(8000);
    expect(report.totals.usedCpu).toBe(4500);
    expect(report.totals.headroomCpu).toBe(2500);
    expect(report.totals.avgCpuUtilization).toBe(56);
  });

  it("handles empty input", () => {
    const report = buildNodeCapacityReport([]);
    expect(report.nodes).toHaveLength(0);
    expect(report.totals.avgCpuUtilization).toBe(0);
  });

  it("clamps headroom to zero", () => {
    const report = buildNodeCapacityReport([
      {
        name: "over",
        allocatableCpuMillicores: 1000,
        allocatableMemoryMiB: 1024,
        requestedCpuMillicores: 2000,
        requestedMemoryMiB: 2048,
        usedCpuMillicores: 800,
        usedMemoryMiB: 900,
      },
    ]);
    expect(report.nodes[0]?.headroomCpuMillicores).toBe(0);
    expect(report.nodes[0]?.headroomMemoryMiB).toBe(0);
  });
});
