import { describe, expect, it } from "vitest";
import { buildPvcUsageReport } from "./pvc-usage-gauge";

describe("pvc-usage-gauge", () => {
  it("calculates usage percent", () => {
    const result = buildPvcUsageReport(
      [{ name: "data", namespace: "prod", capacity: "100Gi" }],
      [
        {
          pvcName: "data",
          namespace: "prod",
          usedBytes: 80 * 1024 ** 3,
          availableBytes: 20 * 1024 ** 3,
        },
      ],
    );
    expect(result.entries[0].usagePercent).toBe(80);
    expect(result.entries[0].status).toBe("warning");
  });

  it("marks critical at 90%+", () => {
    const result = buildPvcUsageReport(
      [{ name: "db", namespace: "ns", capacity: "10Gi" }],
      [
        {
          pvcName: "db",
          namespace: "ns",
          usedBytes: 9.5 * 1024 ** 3,
          availableBytes: 0.5 * 1024 ** 3,
        },
      ],
    );
    expect(result.entries[0].status).toBe("critical");
    expect(result.criticalCount).toBe(1);
  });

  it("handles PVCs without metrics", () => {
    const result = buildPvcUsageReport([{ name: "orphan", namespace: "ns", capacity: "5Gi" }], []);
    expect(result.entries[0].usagePercent).toBe(0);
    expect(result.entries[0].status).toBe("healthy");
  });
});
