import { describe, expect, it, vi } from "vitest";
import {
  clusterMatchesSmartGroup,
  evaluateSmartGroups,
  createSmartGroup,
  type SmartGroup,
  type SmartGroupRule,
} from "./smart-groups";

vi.stubGlobal("crypto", {
  randomUUID: vi.fn().mockReturnValue("sg-uuid-1"),
  getRandomValues: <T extends ArrayBufferView>(values: T) => values,
  subtle: {} as SubtleCrypto,
} as unknown as Crypto);

const clusters = [
  { uuid: "c1", name: "prod-us-east", provider: "AWS EKS", env: "prod", tags: ["aws", "us-east"] },
  { uuid: "c2", name: "staging-eu", provider: "GKE", env: "stage", tags: ["gke", "eu"] },
  { uuid: "c3", name: "dev-local", provider: "Minikube", env: "dev", tags: ["local"] },
  { uuid: "c4", name: "prod-eu-west", provider: "AWS EKS", env: "prod", tags: ["aws", "eu-west"] },
];

function makeSmartGroup(name: string, rules: SmartGroupRule[], matchAll = true): SmartGroup {
  return { id: `sg-${name}`, name, rules, matchAll, collapsed: false };
}

describe("smart-groups", () => {
  describe("createSmartGroup", () => {
    it("creates a smart group with rules", () => {
      const group = createSmartGroup("AWS Prod", [
        { field: "provider", operator: "equals", value: "AWS EKS" },
      ]);
      expect(group.id).toBe("sg-uuid-1");
      expect(group.name).toBe("AWS Prod");
      expect(group.rules).toHaveLength(1);
      expect(group.matchAll).toBe(true);
    });
  });

  describe("clusterMatchesSmartGroup", () => {
    it("matches by provider equals", () => {
      const group = makeSmartGroup("AWS", [
        { field: "provider", operator: "equals", value: "AWS EKS" },
      ]);
      expect(clusterMatchesSmartGroup(clusters[0]!, group)).toBe(true);
      expect(clusterMatchesSmartGroup(clusters[1]!, group)).toBe(false);
    });

    it("matches by name contains", () => {
      const group = makeSmartGroup("Prod", [
        { field: "name", operator: "contains", value: "prod" },
      ]);
      expect(clusterMatchesSmartGroup(clusters[0]!, group)).toBe(true);
      expect(clusterMatchesSmartGroup(clusters[3]!, group)).toBe(true);
      expect(clusterMatchesSmartGroup(clusters[2]!, group)).toBe(false);
    });

    it("matches by name regex", () => {
      const group = makeSmartGroup("EU clusters", [
        { field: "name", operator: "matches", value: "eu" },
      ]);
      expect(clusterMatchesSmartGroup(clusters[1]!, group)).toBe(true);
      expect(clusterMatchesSmartGroup(clusters[3]!, group)).toBe(true);
      expect(clusterMatchesSmartGroup(clusters[2]!, group)).toBe(false);
    });

    it("matches by tags contains", () => {
      const group = makeSmartGroup("AWS tagged", [
        { field: "tags", operator: "equals", value: "aws" },
      ]);
      expect(clusterMatchesSmartGroup(clusters[0]!, group)).toBe(true);
      expect(clusterMatchesSmartGroup(clusters[3]!, group)).toBe(true);
      expect(clusterMatchesSmartGroup(clusters[1]!, group)).toBe(false);
    });

    it("requires all rules with matchAll=true", () => {
      const group = makeSmartGroup(
        "AWS Prod",
        [
          { field: "provider", operator: "equals", value: "AWS EKS" },
          { field: "env", operator: "equals", value: "prod" },
        ],
        true,
      );
      expect(clusterMatchesSmartGroup(clusters[0]!, group)).toBe(true);
      expect(clusterMatchesSmartGroup(clusters[2]!, group)).toBe(false);
    });

    it("requires any rule with matchAll=false", () => {
      const group = makeSmartGroup(
        "AWS or Prod",
        [
          { field: "provider", operator: "equals", value: "GKE" },
          { field: "env", operator: "equals", value: "prod" },
        ],
        false,
      );
      expect(clusterMatchesSmartGroup(clusters[0]!, group)).toBe(true);
      expect(clusterMatchesSmartGroup(clusters[1]!, group)).toBe(true);
      expect(clusterMatchesSmartGroup(clusters[2]!, group)).toBe(false);
    });

    it("returns false for empty rules", () => {
      const group = makeSmartGroup("Empty", []);
      expect(clusterMatchesSmartGroup(clusters[0]!, group)).toBe(false);
    });

    it("handles invalid regex gracefully", () => {
      const group = makeSmartGroup("Bad regex", [
        { field: "name", operator: "matches", value: "[invalid" },
      ]);
      expect(clusterMatchesSmartGroup(clusters[0]!, group)).toBe(false);
    });
  });

  describe("evaluateSmartGroups", () => {
    it("evaluates and assigns clusters to smart groups", () => {
      const smartGroups = [
        makeSmartGroup("Production", [{ field: "env", operator: "equals", value: "prod" }]),
        makeSmartGroup("GKE", [{ field: "provider", operator: "equals", value: "GKE" }]),
      ];

      const result = evaluateSmartGroups(clusters, smartGroups);

      expect(result.grouped).toHaveLength(2);
      expect(result.grouped[0]?.group.name).toBe("Production");
      expect(result.grouped[0]?.clusters).toHaveLength(2);
      expect(result.grouped[1]?.group.name).toBe("GKE");
      expect(result.grouped[1]?.clusters).toHaveLength(1);
      expect(result.ungrouped).toHaveLength(1);
      expect(result.ungrouped[0]?.name).toBe("dev-local");
    });

    it("assigns each cluster to first matching group only", () => {
      const smartGroups = [
        makeSmartGroup("All AWS", [{ field: "provider", operator: "equals", value: "AWS EKS" }]),
        makeSmartGroup("All Prod", [{ field: "env", operator: "equals", value: "prod" }]),
      ];

      const result = evaluateSmartGroups(clusters, smartGroups);

      expect(result.grouped[0]?.clusters).toHaveLength(2);
      // prod-us-east and prod-eu-west already in AWS group, not duplicated in Prod group
      expect(result.grouped).toHaveLength(1);
    });

    it("returns all ungrouped when no smart groups defined", () => {
      const result = evaluateSmartGroups(clusters, []);
      expect(result.grouped).toHaveLength(0);
      expect(result.ungrouped).toHaveLength(4);
    });
  });
});
