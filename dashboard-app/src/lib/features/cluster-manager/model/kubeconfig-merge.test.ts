import { describe, expect, it } from "vitest";
import { mergeKubeconfigs } from "./kubeconfig-merge";

describe("kubeconfig-merge", () => {
  it("merges two configs without conflicts", () => {
    const result = mergeKubeconfigs([
      {
        source: "file1",
        contexts: [{ name: "ctx-a", cluster: "a", user: "u-a" }],
        clusters: [{ name: "a" }],
        users: [{ name: "u-a" }],
      },
      {
        source: "file2",
        contexts: [{ name: "ctx-b", cluster: "b", user: "u-b" }],
        clusters: [{ name: "b" }],
        users: [{ name: "u-b" }],
      },
    ]);

    expect(result.contexts).toHaveLength(2);
    expect(result.clusters).toHaveLength(2);
    expect(result.conflicts).toHaveLength(0);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it("detects and resolves duplicate contexts", () => {
    const result = mergeKubeconfigs([
      {
        source: "file1",
        contexts: [{ name: "shared-ctx", cluster: "a", user: "u-a" }],
        clusters: [{ name: "a" }],
        users: [{ name: "u-a" }],
      },
      {
        source: "file2",
        contexts: [{ name: "shared-ctx", cluster: "b", user: "u-b" }],
        clusters: [{ name: "b" }],
        users: [{ name: "u-b" }],
      },
    ]);

    expect(result.contexts).toHaveLength(1);
    expect(result.contexts[0]?.source).toBe("file2");
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.type).toBe("context");
    expect(result.duplicatesRemoved).toBeGreaterThan(0);
  });

  it("detects cluster name conflicts across files", () => {
    const result = mergeKubeconfigs([
      { source: "f1", contexts: [], clusters: [{ name: "prod" }], users: [] },
      { source: "f2", contexts: [], clusters: [{ name: "prod" }], users: [] },
    ]);

    expect(result.conflicts.some((c) => c.type === "cluster" && c.name === "prod")).toBe(true);
  });

  it("handles empty configs", () => {
    const result = mergeKubeconfigs([]);
    expect(result.contexts).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
  });

  it("tracks sources for each conflict", () => {
    const result = mergeKubeconfigs([
      {
        source: "a.yaml",
        contexts: [{ name: "ctx", cluster: "c", user: "u" }],
        clusters: [{ name: "c" }],
        users: [{ name: "u" }],
      },
      {
        source: "b.yaml",
        contexts: [{ name: "ctx", cluster: "c", user: "u" }],
        clusters: [{ name: "c" }],
        users: [{ name: "u" }],
      },
    ]);

    const ctxConflict = result.conflicts.find((c) => c.type === "context");
    expect(ctxConflict?.sources).toEqual(["a.yaml", "b.yaml"]);
  });
});
