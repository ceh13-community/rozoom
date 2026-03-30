import { describe, expect, it } from "vitest";
import type { PodItem } from "$shared/model/clusters";
import { filterMetricsForPods, parseTopPodMetricsOutput } from "./pod-metrics";

describe("pod metrics model", () => {
  it("parses kubectl top output into pod metrics values", () => {
    const metrics = parseTopPodMetricsOutput(
      ["prod api-0 12m 48Mi", "jobs worker-0 1 1Gi"].join("\n"),
    );

    expect(metrics.get("prod/api-0")).toEqual({
      cpu: "12m",
      memory: "48Mi",
      cpuMillicores: 12,
      memoryBytes: 48 * 1024 * 1024,
    });
    expect(metrics.get("jobs/worker-0")).toEqual({
      cpu: "1",
      memory: "1Gi",
      cpuMillicores: 1000,
      memoryBytes: 1024 * 1024 * 1024,
    });
  });

  it("filters metrics to the current pod set", () => {
    const metrics = new Map([
      [
        "prod/api-0",
        { cpu: "10m", memory: "32Mi", cpuMillicores: 10, memoryBytes: 32 * 1024 * 1024 },
      ],
      [
        "prod/api-1",
        { cpu: "20m", memory: "64Mi", cpuMillicores: 20, memoryBytes: 64 * 1024 * 1024 },
      ],
    ]);

    const filtered = filterMetricsForPods(metrics, [
      {
        metadata: { namespace: "prod", name: "api-1" },
      } as unknown as Partial<PodItem>,
    ]);

    expect([...filtered.keys()]).toEqual(["prod/api-1"]);
  });
});
