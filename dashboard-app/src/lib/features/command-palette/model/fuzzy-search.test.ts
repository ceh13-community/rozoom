import { describe, expect, it } from "vitest";
import { fuzzyFilter, fuzzyScore } from "./fuzzy-search";

describe("fuzzyScore", () => {
  it("returns 100 for exact prefix", () => {
    expect(fuzzyScore("dep", "Deployments")).toBe(100);
  });

  it("returns 80 for substring match", () => {
    expect(fuzzyScore("ploy", "Deployments")).toBe(80);
  });

  it("returns 40 for subsequence match", () => {
    expect(fuzzyScore("dps", "Deployments")).toBe(40);
  });

  it("returns 0 for no match", () => {
    expect(fuzzyScore("xyz", "Deployments")).toBe(0);
  });

  it("returns 1 for empty query", () => {
    expect(fuzzyScore("", "anything")).toBe(1);
  });
});

describe("fuzzyFilter", () => {
  const items = [
    { label: "Pods", keywords: ["pod", "workload"] },
    { label: "Deployments", keywords: ["deploy", "workload"] },
    { label: "DaemonSets", keywords: ["daemon"] },
    { label: "ConfigMaps", keywords: ["config", "cm"] },
  ];

  it("returns all items for empty query", () => {
    expect(fuzzyFilter(items, "")).toHaveLength(4);
  });

  it("filters by label", () => {
    const result = fuzzyFilter(items, "dep");
    expect(result[0].label).toBe("Deployments");
  });

  it("filters by keyword", () => {
    const result = fuzzyFilter(items, "cm");
    expect(result[0].label).toBe("ConfigMaps");
  });

  it("returns empty for no match", () => {
    expect(fuzzyFilter(items, "zzz")).toHaveLength(0);
  });

  it("ranks exact prefix higher than substring", () => {
    const result = fuzzyFilter(items, "pod");
    expect(result[0].label).toBe("Pods");
  });
});
