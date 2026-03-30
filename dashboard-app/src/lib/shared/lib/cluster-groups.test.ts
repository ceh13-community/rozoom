import { describe, expect, it, vi } from "vitest";
import {
  addGroup,
  removeGroup,
  renameGroup,
  toggleGroupCollapsed,
  assignClusterToGroup,
  unassignCluster,
  moveClusterToGroup,
  groupClusters,
  type ClusterGroup,
} from "./cluster-groups";

vi.stubGlobal("crypto", {
  randomUUID: vi.fn().mockReturnValue("group-uuid-1"),
  getRandomValues: <T extends ArrayBufferView>(values: T) => values,
  subtle: {} as SubtleCrypto,
} as unknown as Crypto);

const makeGroup = (id: string, name: string): ClusterGroup => ({
  id,
  name,
  collapsed: false,
});

describe("cluster-groups", () => {
  describe("addGroup", () => {
    it("adds a new group to the list", () => {
      const groups = addGroup([], "Production");
      expect(groups).toHaveLength(1);
      expect(groups[0]?.name).toBe("Production");
      expect(groups[0]?.id).toBe("group-uuid-1");
    });

    it("preserves existing groups", () => {
      const existing = [makeGroup("g1", "Existing")];
      const groups = addGroup(existing, "New");
      expect(groups).toHaveLength(2);
      expect(groups[0]?.name).toBe("Existing");
    });
  });

  describe("removeGroup", () => {
    it("removes group and cleans up membership", () => {
      const groups = [makeGroup("g1", "Prod"), makeGroup("g2", "Dev")];
      const membership = { c1: "g1", c2: "g2", c3: "g1" };

      const result = removeGroup(groups, membership, "g1");

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0]?.name).toBe("Dev");
      expect(result.membership).toEqual({ c2: "g2" });
    });
  });

  describe("renameGroup", () => {
    it("renames the target group", () => {
      const groups = [makeGroup("g1", "Old Name")];
      const result = renameGroup(groups, "g1", "New Name");
      expect(result[0]?.name).toBe("New Name");
    });

    it("leaves other groups unchanged", () => {
      const groups = [makeGroup("g1", "A"), makeGroup("g2", "B")];
      const result = renameGroup(groups, "g1", "C");
      expect(result[1]?.name).toBe("B");
    });
  });

  describe("toggleGroupCollapsed", () => {
    it("toggles collapsed state", () => {
      const groups = [makeGroup("g1", "Test")];
      const toggled = toggleGroupCollapsed(groups, "g1");
      expect(toggled[0]?.collapsed).toBe(true);

      const toggledBack = toggleGroupCollapsed(toggled, "g1");
      expect(toggledBack[0]?.collapsed).toBe(false);
    });
  });

  describe("membership operations", () => {
    it("assigns cluster to group", () => {
      const membership = assignClusterToGroup({}, "c1", "g1");
      expect(membership).toEqual({ c1: "g1" });
    });

    it("unassigns cluster from group", () => {
      const membership = unassignCluster({ c1: "g1", c2: "g2" }, "c1");
      expect(membership).toEqual({ c2: "g2" });
    });

    it("moves cluster to different group", () => {
      const membership = moveClusterToGroup({ c1: "g1" }, "c1", "g2");
      expect(membership).toEqual({ c1: "g2" });
    });

    it("removes from group when moving to null", () => {
      const membership = moveClusterToGroup({ c1: "g1" }, "c1", null);
      expect(membership).toEqual({});
    });
  });

  describe("groupClusters", () => {
    const clusters = [
      { uuid: "c1", name: "alpha" },
      { uuid: "c2", name: "beta" },
      { uuid: "c3", name: "gamma" },
      { uuid: "c4", name: "delta" },
    ];

    it("groups clusters by membership", () => {
      const groups = [makeGroup("g1", "Prod"), makeGroup("g2", "Dev")];
      const membership = { c1: "g1", c2: "g2", c3: "g1" };

      const result = groupClusters(clusters, groups, membership);

      expect(result).toHaveLength(3);
      expect(result[0]?.group?.name).toBe("Prod");
      expect(result[0]?.clusters).toHaveLength(2);
      expect(result[1]?.group?.name).toBe("Dev");
      expect(result[1]?.clusters).toHaveLength(1);
      expect(result[2]?.group).toBeNull();
      expect(result[2]?.clusters).toHaveLength(1);
      expect(result[2]?.clusters[0]?.name).toBe("delta");
    });

    it("puts all clusters in ungrouped when no membership", () => {
      const groups = [makeGroup("g1", "Prod")];
      const result = groupClusters(clusters, groups, {});

      expect(result).toHaveLength(1);
      expect(result[0]?.group).toBeNull();
      expect(result[0]?.clusters).toHaveLength(4);
    });

    it("skips empty groups", () => {
      const groups = [makeGroup("g1", "Prod"), makeGroup("g2", "Empty")];
      const membership = { c1: "g1" };

      const result = groupClusters(clusters, groups, membership);

      expect(result).toHaveLength(2);
      expect(result[0]?.group?.name).toBe("Prod");
      expect(result[1]?.group).toBeNull();
    });

    it("handles cluster assigned to deleted group", () => {
      const groups = [makeGroup("g1", "Prod")];
      const membership = { c1: "g1", c2: "deleted-group" };

      const result = groupClusters(clusters, groups, membership);

      expect(result[0]?.group?.name).toBe("Prod");
      expect(result[0]?.clusters).toHaveLength(1);
      expect(result[1]?.group).toBeNull();
      expect(result[1]?.clusters).toHaveLength(3);
    });
  });
});
