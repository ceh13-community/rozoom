import { describe, expect, it } from "vitest";
import { mergeWorkloadArraySnapshot } from "./merge-workload-array-snapshot";

describe("mergeWorkloadArraySnapshot", () => {
  it("reuses unchanged entries by uid/resourceVersion", () => {
    const prev = [
      { metadata: { uid: "a", resourceVersion: "1" }, status: { phase: "Running" } },
      { metadata: { uid: "b", resourceVersion: "5" }, status: { phase: "Pending" } },
    ];
    const next = [
      { metadata: { uid: "a", resourceVersion: "1" }, status: { phase: "Running" } },
      { metadata: { uid: "b", resourceVersion: "6" }, status: { phase: "Running" } },
    ];

    const merged = mergeWorkloadArraySnapshot(prev, next);
    expect(merged.reusedCount).toBe(1);
    expect(merged.merged[0]).toBe(prev[0]);
    expect(merged.merged[1]).toEqual(next[1]);
  });

  it("falls back to next entries when previous data is empty", () => {
    const next = [{ metadata: { uid: "x" }, status: { phase: "Running" } }];
    const merged = mergeWorkloadArraySnapshot([], next);
    expect(merged.reusedCount).toBe(0);
    expect(merged.merged).toBe(next);
  });
});
