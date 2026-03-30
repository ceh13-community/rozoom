import { describe, it, expect, beforeEach } from "vitest";
import { upsertNodesAge, removeNodeAge, getNodeCreatedAt, clearNodesAge } from "./nodes-age";
import type { NodeItem } from "$shared/model/clusters";

describe("nodes-age", () => {
  beforeEach(() => {
    clearNodesAge();
  });

  const createMockNode = (
    uid: string,
    name: string,
    creationTimestamp: string,
  ): Partial<NodeItem> => ({
    metadata: {
      uid,
      name,
      namespace: "",
      creationTimestamp,
    },
  });

  describe("upsertNodesAge", () => {
    it("should cache node creation timestamp by uid", () => {
      const node = createMockNode("uid-123", "node-1", "2024-01-15T10:30:00Z");

      upsertNodesAge([node]);

      const result = getNodeCreatedAt("uid-123");
      expect(result).toEqual(new Date("2024-01-15T10:30:00Z"));
    });

    it("should use name as fallback when uid is missing", () => {
      const node: Partial<NodeItem> = {
        metadata: {
          name: "node-1",
          namespace: "",
          creationTimestamp: "2024-01-15T10:30:00Z",
        },
      };

      upsertNodesAge([node]);

      const result = getNodeCreatedAt("node-1");
      expect(result).toEqual(new Date("2024-01-15T10:30:00Z"));
    });

    it("should prefer uid over name when both exist", () => {
      const node = createMockNode("uid-123", "node-1", "2024-01-15T10:30:00Z");

      upsertNodesAge([node]);

      expect(getNodeCreatedAt("uid-123")).toBeDefined();
      expect(getNodeCreatedAt("node-1")).toBeUndefined();
    });

    it("should cache multiple nodes", () => {
      const nodes = [
        createMockNode("uid-1", "node-1", "2024-01-15T10:00:00Z"),
        createMockNode("uid-2", "node-2", "2024-01-15T11:00:00Z"),
        createMockNode("uid-3", "node-3", "2024-01-15T12:00:00Z"),
      ];

      upsertNodesAge(nodes);

      expect(getNodeCreatedAt("uid-1")).toEqual(new Date("2024-01-15T10:00:00Z"));
      expect(getNodeCreatedAt("uid-2")).toEqual(new Date("2024-01-15T11:00:00Z"));
      expect(getNodeCreatedAt("uid-3")).toEqual(new Date("2024-01-15T12:00:00Z"));
    });

    it("should not overwrite existing cache entry", () => {
      const node1 = createMockNode("uid-123", "node-1", "2024-01-15T10:00:00Z");
      const node2 = createMockNode("uid-123", "node-1", "2024-01-15T12:00:00Z");

      upsertNodesAge([node1]);
      upsertNodesAge([node2]);

      const result = getNodeCreatedAt("uid-123");
      expect(result).toEqual(new Date("2024-01-15T10:00:00Z"));
    });

    it("should skip nodes without key (no uid or name)", () => {
      const node: Partial<NodeItem> = {
        metadata: {
          namespace: "",
          creationTimestamp: "2024-01-15T10:00:00Z",
        } as any,
      };

      upsertNodesAge([node]);

      expect(getNodeCreatedAt("anything")).toBeUndefined();
    });

    it("should skip nodes without metadata", () => {
      const node: Partial<NodeItem> = {};

      upsertNodesAge([node]);

      expect(getNodeCreatedAt("anything")).toBeUndefined();
    });

    it("should handle empty array", () => {
      upsertNodesAge([]);

      expect(getNodeCreatedAt("anything")).toBeUndefined();
    });

    it("should handle nodes with undefined uid", () => {
      const node: Partial<NodeItem> = {
        metadata: {
          uid: undefined,
          name: "node-1",
          namespace: "",
          creationTimestamp: "2024-01-15T10:00:00Z",
        },
      };

      upsertNodesAge([node]);

      expect(getNodeCreatedAt("node-1")).toEqual(new Date("2024-01-15T10:00:00Z"));
    });

    it("should parse various date formats", () => {
      const node1 = createMockNode("uid-1", "node-1", "2024-01-15T10:30:00.000Z");
      const node2 = createMockNode("uid-2", "node-2", "2024-01-15T10:30:00Z");
      const node3 = createMockNode("uid-3", "node-3", "2024-01-15");

      upsertNodesAge([node1, node2, node3]);

      expect(getNodeCreatedAt("uid-1")).toBeInstanceOf(Date);
      expect(getNodeCreatedAt("uid-2")).toBeInstanceOf(Date);
      expect(getNodeCreatedAt("uid-3")).toBeInstanceOf(Date);
    });
  });

  describe("removeNodeAge", () => {
    it("should remove node from cache", () => {
      const node = createMockNode("uid-123", "node-1", "2024-01-15T10:00:00Z");

      upsertNodesAge([node]);
      expect(getNodeCreatedAt("uid-123")).toBeDefined();

      removeNodeAge("uid-123");
      expect(getNodeCreatedAt("uid-123")).toBeUndefined();
    });

    it("should handle removing non-existent key", () => {
      removeNodeAge("non-existent");

      expect(getNodeCreatedAt("non-existent")).toBeUndefined();
    });

    it("should only remove specific node", () => {
      const nodes = [
        createMockNode("uid-1", "node-1", "2024-01-15T10:00:00Z"),
        createMockNode("uid-2", "node-2", "2024-01-15T11:00:00Z"),
      ];

      upsertNodesAge(nodes);

      removeNodeAge("uid-1");

      expect(getNodeCreatedAt("uid-1")).toBeUndefined();
      expect(getNodeCreatedAt("uid-2")).toBeDefined();
    });
  });

  describe("getNodeCreatedAt", () => {
    it("should return Date object for cached node", () => {
      const node = createMockNode("uid-123", "node-1", "2024-01-15T10:30:00Z");

      upsertNodesAge([node]);

      const result = getNodeCreatedAt("uid-123");
      expect(result).toBeInstanceOf(Date);
      expect(result?.getTime()).toBe(new Date("2024-01-15T10:30:00Z").getTime());
    });

    it("should return undefined for non-existent key", () => {
      const result = getNodeCreatedAt("non-existent");
      expect(result).toBeUndefined();
    });

    it("should return different Date instance on each call", () => {
      const node = createMockNode("uid-123", "node-1", "2024-01-15T10:00:00Z");

      upsertNodesAge([node]);

      const result1 = getNodeCreatedAt("uid-123");
      const result2 = getNodeCreatedAt("uid-123");

      expect(result1).not.toBe(result2);
      expect(result1?.getTime()).toBe(result2?.getTime());
    });

    it("should handle empty string key", () => {
      const result = getNodeCreatedAt("");
      expect(result).toBeUndefined();
    });
  });

  describe("clearNodesAge", () => {
    it("should clear all cached nodes", () => {
      const nodes = [
        createMockNode("uid-1", "node-1", "2024-01-15T10:00:00Z"),
        createMockNode("uid-2", "node-2", "2024-01-15T11:00:00Z"),
        createMockNode("uid-3", "node-3", "2024-01-15T12:00:00Z"),
      ];

      upsertNodesAge(nodes);

      clearNodesAge();

      expect(getNodeCreatedAt("uid-1")).toBeUndefined();
      expect(getNodeCreatedAt("uid-2")).toBeUndefined();
      expect(getNodeCreatedAt("uid-3")).toBeUndefined();
    });

    it("should allow re-adding nodes after clear", () => {
      const node = createMockNode("uid-123", "node-1", "2024-01-15T10:00:00Z");

      upsertNodesAge([node]);
      clearNodesAge();

      const newNode = createMockNode("uid-123", "node-1", "2024-01-15T12:00:00Z");
      upsertNodesAge([newNode]);

      const result = getNodeCreatedAt("uid-123");
      expect(result).toEqual(new Date("2024-01-15T12:00:00Z"));
    });

    it("should handle clearing empty cache", () => {
      clearNodesAge();
      clearNodesAge();

      expect(getNodeCreatedAt("anything")).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("should handle invalid date strings gracefully", () => {
      const node = createMockNode("uid-123", "node-1", "invalid-date");

      upsertNodesAge([node]);

      const result = getNodeCreatedAt("uid-123");
      expect(result).toBeInstanceOf(Date);
      expect(result?.getTime()).toBeNaN();
    });

    it("should preserve timestamp accuracy", () => {
      const timestamp = "2024-01-15T10:30:45.123Z";
      const node = createMockNode("uid-123", "node-1", timestamp);

      upsertNodesAge([node]);

      const result = getNodeCreatedAt("uid-123");
      expect(result?.toISOString()).toBe(timestamp);
    });

    it("should handle nodes with same name but different uid", () => {
      const node1 = createMockNode("uid-1", "node-same", "2024-01-15T10:00:00Z");
      const node2 = createMockNode("uid-2", "node-same", "2024-01-15T11:00:00Z");

      upsertNodesAge([node1, node2]);

      expect(getNodeCreatedAt("uid-1")).toEqual(new Date("2024-01-15T10:00:00Z"));
      expect(getNodeCreatedAt("uid-2")).toEqual(new Date("2024-01-15T11:00:00Z"));
      expect(getNodeCreatedAt("node-same")).toBeUndefined();
    });

    it("should handle very old timestamps", () => {
      const node = createMockNode("uid-123", "node-1", "1970-01-01T00:00:00Z");

      upsertNodesAge([node]);

      const result = getNodeCreatedAt("uid-123");
      expect(result?.getTime()).toBe(0);
    });

    it("should handle future timestamps", () => {
      const node = createMockNode("uid-123", "node-1", "2099-12-31T23:59:59Z");

      upsertNodesAge([node]);

      const result = getNodeCreatedAt("uid-123");
      expect(result).toEqual(new Date("2099-12-31T23:59:59Z"));
    });
  });
});
