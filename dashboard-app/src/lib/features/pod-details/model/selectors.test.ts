import { describe, expect, it } from "vitest";
import { extractPodAnnotations, extractPodIp, extractPodLabels } from "./selectors";

describe("pod-details selectors", () => {
  it("extracts labels and annotations", () => {
    const pod = {
      metadata: {
        name: "pod-a",
        namespace: "default",
        labels: { app: "demo", tier: "web" },
        annotations: { "a/b": "1" },
      },
      status: { phase: "Running", podIP: "10.0.0.10" },
    };

    expect(extractPodLabels(pod)).toEqual([
      ["app", "demo"],
      ["tier", "web"],
    ]);
    expect(extractPodAnnotations(pod)).toEqual([["a/b", "1"]]);
    expect(extractPodIp(pod)).toBe("10.0.0.10");
  });

  it("returns fallbacks for missing fields", () => {
    expect(extractPodLabels({})).toEqual([]);
    expect(extractPodAnnotations({})).toEqual([]);
    expect(extractPodIp({})).toBe("-");
  });
});
