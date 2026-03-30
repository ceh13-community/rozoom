import { describe, expect, it } from "vitest";
import { resolveClusterIds, resolvePrimaryClusterId } from "./cluster-ids";

describe("cluster-ids", () => {
  it("returns uuid first, then slug, without duplicates", () => {
    expect(resolveClusterIds({ uuid: "cluster-1", slug: "cluster-a" })).toEqual([
      "cluster-1",
      "cluster-a",
    ]);
    expect(resolveClusterIds({ uuid: "same", slug: "same" })).toEqual(["same"]);
  });

  it("drops empty values and trims whitespace", () => {
    expect(resolveClusterIds({ uuid: "  ", slug: " cluster-a " })).toEqual(["cluster-a"]);
    expect(resolveClusterIds({ uuid: null, slug: undefined })).toEqual([]);
  });

  it("resolves primary cluster id", () => {
    expect(resolvePrimaryClusterId({ uuid: "cluster-1", slug: "cluster-a" })).toBe("cluster-1");
    expect(resolvePrimaryClusterId({ slug: "cluster-a" })).toBe("cluster-a");
    expect(resolvePrimaryClusterId({})).toBe("");
  });
});
