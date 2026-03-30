import { describe, it, expect } from "vitest";
import { clusterKey } from "./cluster-key";

describe("clusterKey", () => {
  it("returns empty string when input is undefined", () => {
    expect(clusterKey(undefined)).toBe("");
  });

  it("returns empty string when input is null", () => {
    expect(clusterKey(null)).toBe("");
  });

  it("returns empty string when input is empty string", () => {
    expect(clusterKey("")).toBe("");
  });

  it("returns empty string when input contains only whitespace", () => {
    expect(clusterKey("   \t\n  ")).toBe("");
  });

  it("keeps valid alphanumeric characters and allowed symbols", () => {
    expect(clusterKey("my-cluster-123")).toBe("my-cluster-123");
    expect(clusterKey("prod.us-west-2")).toBe("prod.us-west-2");
    expect(clusterKey("team_A_v2")).toBe("team_A_v2");
  });

  it("replaces all unsafe characters with underscore", () => {
    expect(clusterKey("My Cluster #1!")).toBe("My_Cluster_1_");
    expect(clusterKey("staging@eu-central")).toBe("staging_eu-central");
    expect(clusterKey("dev / test")).toBe("dev_test");
  });

  it("replaces multiple consecutive unsafe characters with single underscore", () => {
    expect(clusterKey("bad   name!!!")).toBe("bad_name_");
    expect(clusterKey("project:prod@v1")).toBe("project_prod_v1");
  });

  it("handles unicode / non-latin characters by replacing them", () => {
    expect(clusterKey("кластер Київ")).toBe("_");
    expect(clusterKey("東京-cluster")).toBe("_-cluster");
  });

  it("preserves dots, underscores, hyphens", () => {
    expect(clusterKey("v1.2.3-alpha")).toBe("v1.2.3-alpha");
    expect(clusterKey("stage_us-east")).toBe("stage_us-east");
  });

  it("trims leading/trailing spaces before sanitizing", () => {
    expect(clusterKey("  prod-us  ")).toBe("prod-us");
    expect(clusterKey("   invalid@name   ")).toBe("invalid_name");
  });

  it("handles very long input", () => {
    const longInput = "a".repeat(300) + "!!!###";
    const result = clusterKey(longInput);
    expect(result).toBe("a".repeat(300) + "_");
    expect(result.length).toBe(301);
  });
});
