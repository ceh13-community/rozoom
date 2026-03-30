import { describe, expect, it } from "vitest";
import { computeResourceDiff } from "./resource-diff";

describe("resource-diff", () => {
  it("detects identical content", () => {
    const result = computeResourceDiff("a\nb\nc", "a\nb\nc");
    expect(result.identical).toBe(true);
    expect(result.additions).toBe(0);
  });

  it("detects additions", () => {
    const result = computeResourceDiff("a\nb", "a\nb\nc");
    expect(result.additions).toBe(1);
    expect(result.lines[2].kind).toBe("added");
  });

  it("detects deletions", () => {
    const result = computeResourceDiff("a\nb\nc", "a\nb");
    expect(result.deletions).toBe(1);
  });

  it("detects modifications", () => {
    const result = computeResourceDiff("replicas: 1", "replicas: 3");
    expect(result.modifications).toBe(1);
    expect(result.lines[0].kind).toBe("modified");
    expect(result.lines[0].otherContent).toBe("replicas: 1");
  });
});
