import { describe, expect, it } from "vitest";
import { calculateBinPacking } from "./bin-packing";

describe("bin-packing", () => {
  it("calculates packing scores for nodes", () => {
    const report = calculateBinPacking([
      {
        name: "n1",
        allocatableCpuMillicores: 4000,
        allocatableMemoryMiB: 8192,
        requestedCpuMillicores: 3600,
        requestedMemoryMiB: 7000,
      },
      {
        name: "n2",
        allocatableCpuMillicores: 4000,
        allocatableMemoryMiB: 8192,
        requestedCpuMillicores: 1000,
        requestedMemoryMiB: 2000,
      },
    ]);

    expect(report.nodes).toHaveLength(2);
    expect(report.nodes[0]?.grade).toBe("tight");
    expect(report.nodes[1]?.grade).toBe("sparse");
    expect(report.clusterScore).toBeGreaterThan(0);
    expect(report.fragmentationPercent).toBe(50);
  });

  it("returns balanced for moderate packing", () => {
    const report = calculateBinPacking([
      {
        name: "n1",
        allocatableCpuMillicores: 4000,
        allocatableMemoryMiB: 8192,
        requestedCpuMillicores: 2500,
        requestedMemoryMiB: 5000,
      },
    ]);

    expect(report.nodes[0]?.grade).toBe("balanced");
    expect(report.clusterGrade).toBe("balanced");
  });

  it("returns empty for no nodes", () => {
    const report = calculateBinPacking([]);
    expect(report.clusterScore).toBe(0);
    expect(report.clusterGrade).toBe("empty");
  });

  it("caps score at 100", () => {
    const report = calculateBinPacking([
      {
        name: "n1",
        allocatableCpuMillicores: 1000,
        allocatableMemoryMiB: 1024,
        requestedCpuMillicores: 2000,
        requestedMemoryMiB: 2048,
      },
    ]);

    expect(report.nodes[0]?.score).toBeLessThanOrEqual(100);
    expect(report.clusterScore).toBeLessThanOrEqual(100);
  });
});
