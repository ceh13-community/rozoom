import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyNodeEvent } from "./nodes-apply";
import { nodesStore } from "./nodes-store";
import { updateNodeHealth } from "./node-health-updater";
import type { NodeWatchEvent } from "./nodes-parser";
import type { NodeItem, NodeMetadata } from "$shared/model/clusters";
import { get } from "svelte/store";

vi.mock("./node-health-updater", () => ({
  updateNodeHealth: vi.fn(),
}));

describe("applyNodeEvent", () => {
  const clusterId = "test-cluster-1";

  beforeEach(() => {
    vi.clearAllMocks();
    nodesStore.set({});
  });

  describe("ADDED event", () => {
    it("should add new node to empty cluster", () => {
      const event: NodeWatchEvent = {
        type: "ADDED",
        object: {
          metadata: { name: "node-1" },
          spec: {},
          status: {},
        } as NodeItem,
      };

      applyNodeEvent(clusterId, event);

      const state = get(nodesStore);
      expect(state[clusterId]).toHaveLength(1);
      expect(state[clusterId][0].metadata?.name).toBe("node-1");
    });

    it("should add new node to existing cluster", () => {
      const existingNode: Partial<NodeItem> = {
        metadata: { name: "node-1" } as NodeMetadata,
      };

      nodesStore.set({
        [clusterId]: [existingNode as NodeItem],
      });

      const event: NodeWatchEvent = {
        type: "ADDED",
        object: {
          metadata: { name: "node-2" },
          spec: {},
          status: {},
        } as NodeItem,
      };

      applyNodeEvent(clusterId, event);

      const state = get(nodesStore);
      expect(state[clusterId]).toHaveLength(2);
      expect(state[clusterId][1].metadata?.name).toBe("node-2");
    });

    it("should not duplicate node if already exists", () => {
      const existingNode: Partial<NodeItem> = {
        metadata: { name: "node-1" } as NodeMetadata,
        status: { conditions: [] },
      };

      nodesStore.set({
        [clusterId]: [existingNode as NodeItem],
      });

      const event: NodeWatchEvent = {
        type: "ADDED",
        object: {
          metadata: { name: "node-1" },
          spec: {},
          status: { conditions: [{ type: "Ready", status: "True" }] },
        } as NodeItem,
      };

      applyNodeEvent(clusterId, event);

      const state = get(nodesStore);
      expect(state[clusterId]).toHaveLength(1);
      expect(state[clusterId][0].status?.conditions).toHaveLength(1);
    });

    it("should preserve other clusters when adding node", () => {
      const otherClusterNode: Partial<NodeItem> = {
        metadata: { name: "other-node" } as NodeMetadata,
      };

      nodesStore.set({
        "other-cluster": [otherClusterNode as NodeItem],
      });

      const event: NodeWatchEvent = {
        type: "ADDED",
        object: {
          metadata: { name: "node-1" },
          spec: {},
          status: {},
        } as NodeItem,
      };

      applyNodeEvent(clusterId, event);

      const state = get(nodesStore);
      expect(state["other-cluster"]).toHaveLength(1);
      expect(state[clusterId]).toHaveLength(1);
    });
  });

  describe("MODIFIED event", () => {
    it("should update existing node", () => {
      const existingNode: Partial<NodeItem> = {
        metadata: { name: "node-1" } as NodeMetadata,
        status: { conditions: [] },
      };

      nodesStore.set({
        [clusterId]: [existingNode as NodeItem],
      });

      const event: NodeWatchEvent = {
        type: "MODIFIED",
        object: {
          metadata: { name: "node-1" },
          spec: {},
          status: { conditions: [{ type: "Ready", status: "True" }] },
        } as NodeItem,
      };

      applyNodeEvent(clusterId, event);

      const state = get(nodesStore);
      expect(state[clusterId]).toHaveLength(1);
      expect(state[clusterId][0].status?.conditions).toHaveLength(1);
    });

    it("should add node if not found on MODIFIED", () => {
      nodesStore.set({
        [clusterId]: [],
      });

      const event: NodeWatchEvent = {
        type: "MODIFIED",
        object: {
          metadata: { name: "node-1" },
          spec: {},
          status: {},
        } as NodeItem,
      };

      applyNodeEvent(clusterId, event);

      const state = get(nodesStore);
      expect(state[clusterId]).toHaveLength(1);
      expect(state[clusterId][0].metadata?.name).toBe("node-1");
    });

    it("should update correct node when multiple exist", () => {
      const node1: Partial<NodeItem> = {
        metadata: { name: "node-1" } as NodeMetadata,
        status: { conditions: [] },
      };

      const node2: Partial<NodeItem> = {
        metadata: { name: "node-2" } as NodeMetadata,
        status: { conditions: [] },
      };

      nodesStore.set({
        [clusterId]: [node1 as NodeItem, node2 as NodeItem],
      });

      const event: NodeWatchEvent = {
        type: "MODIFIED",
        object: {
          metadata: { name: "node-2" },
          spec: {},
          status: { conditions: [{ type: "Ready", status: "False" }] },
        } as NodeItem,
      };

      applyNodeEvent(clusterId, event);

      const state = get(nodesStore);
      expect(state[clusterId]).toHaveLength(2);
      expect(state[clusterId][0].metadata?.name).toBe("node-1");
      expect(state[clusterId][1].status?.conditions).toHaveLength(1);
    });
  });

  describe("DELETED event", () => {
    it("should remove node from cluster", () => {
      const existingNode: Partial<NodeItem> = {
        metadata: { name: "node-1" } as NodeMetadata,
      };

      nodesStore.set({
        [clusterId]: [existingNode as NodeItem],
      });

      const event: NodeWatchEvent = {
        type: "DELETED",
        object: {
          metadata: { name: "node-1" },
          spec: {},
          status: {},
        } as NodeItem,
      };

      applyNodeEvent(clusterId, event);

      const state = get(nodesStore);
      expect(state[clusterId]).toHaveLength(0);
    });

    it("should remove correct node when multiple exist", () => {
      const node1: Partial<NodeItem> = {
        metadata: { name: "node-1" } as NodeMetadata,
      };

      const node2: Partial<NodeItem> = {
        metadata: { name: "node-2" } as NodeMetadata,
      };

      const node3: Partial<NodeItem> = {
        metadata: { name: "node-3" } as NodeMetadata,
      };

      nodesStore.set({
        [clusterId]: [node1 as NodeItem, node2 as NodeItem, node3 as NodeItem],
      });

      const event: NodeWatchEvent = {
        type: "DELETED",
        object: {
          metadata: { name: "node-2" },
          spec: {},
          status: {},
        } as NodeItem,
      };

      applyNodeEvent(clusterId, event);

      const state = get(nodesStore);
      expect(state[clusterId]).toHaveLength(2);
      expect(state[clusterId][0].metadata?.name).toBe("node-1");
      expect(state[clusterId][1].metadata?.name).toBe("node-3");
    });

    it("should not affect state if node not found on delete", () => {
      const existingNode: Partial<NodeItem> = {
        metadata: { name: "node-1" } as NodeMetadata,
      };

      nodesStore.set({
        [clusterId]: [existingNode as NodeItem],
      });

      const event: NodeWatchEvent = {
        type: "DELETED",
        object: {
          metadata: { name: "non-existent-node" },
          spec: {},
          status: {},
        } as NodeItem,
      };

      applyNodeEvent(clusterId, event);

      const state = get(nodesStore);
      expect(state[clusterId]).toHaveLength(1);
      expect(state[clusterId][0].metadata?.name).toBe("node-1");
    });

    it("should preserve other clusters when deleting node", () => {
      const otherClusterNode: Partial<NodeItem> = {
        metadata: { name: "other-node" } as NodeMetadata,
      };

      const thisClusterNode: Partial<NodeItem> = {
        metadata: { name: "node-1" } as NodeMetadata,
      };

      nodesStore.set({
        "other-cluster": [otherClusterNode as NodeItem],
        [clusterId]: [thisClusterNode as NodeItem],
      });

      const event: NodeWatchEvent = {
        type: "DELETED",
        object: {
          metadata: { name: "node-1" },
          spec: {},
          status: {},
        } as NodeItem,
      };

      applyNodeEvent(clusterId, event);

      const state = get(nodesStore);
      expect(state["other-cluster"]).toHaveLength(1);
      expect(state[clusterId]).toHaveLength(0);
    });
  });

  describe("updateNodeHealth integration", () => {
    it("should call updateNodeHealth after ADDED event", () => {
      const event: NodeWatchEvent = {
        type: "ADDED",
        object: {
          metadata: { name: "node-1" },
          spec: {},
          status: {},
        } as NodeItem,
      };

      applyNodeEvent(clusterId, event);

      expect(updateNodeHealth).toHaveBeenCalledWith(clusterId);
    });

    it("should call updateNodeHealth after MODIFIED event", () => {
      const existingNode: Partial<NodeItem> = {
        metadata: { name: "node-1" } as NodeMetadata,
      };

      nodesStore.set({
        [clusterId]: [existingNode as NodeItem],
      });

      const event: NodeWatchEvent = {
        type: "MODIFIED",
        object: {
          metadata: { name: "node-1" },
          spec: {},
          status: { conditions: [{ type: "Ready", status: "True" }] },
        } as NodeItem,
      };

      applyNodeEvent(clusterId, event);

      expect(updateNodeHealth).toHaveBeenCalledWith(clusterId);
    });

    it("should call updateNodeHealth after DELETED event", () => {
      const existingNode: Partial<NodeItem> = {
        metadata: { name: "node-1" } as NodeMetadata,
      };

      nodesStore.set({
        [clusterId]: [existingNode as NodeItem],
      });

      const event: NodeWatchEvent = {
        type: "DELETED",
        object: {
          metadata: { name: "node-1" },
          spec: {},
          status: {},
        } as NodeItem,
      };

      applyNodeEvent(clusterId, event);

      expect(updateNodeHealth).toHaveBeenCalledWith(clusterId);
    });

    it("should call updateNodeHealth exactly once per event", () => {
      const event: NodeWatchEvent = {
        type: "ADDED",
        object: {
          metadata: { name: "node-1" },
          spec: {},
          status: {},
        } as NodeItem,
      };

      applyNodeEvent(clusterId, event);

      expect(updateNodeHealth).toHaveBeenCalledTimes(1);
    });

    it("should not await updateNodeHealth (void call)", () => {
      const event: NodeWatchEvent = {
        type: "ADDED",
        object: {
          metadata: { name: "node-1" },
          spec: {},
          status: {},
        } as NodeItem,
      };

      const mockPromise = Promise.resolve();
      vi.mocked(updateNodeHealth).mockReturnValue(mockPromise);

      applyNodeEvent(clusterId, event);

      expect(updateNodeHealth).toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("should handle nodes without metadata.name", () => {
      const event: NodeWatchEvent = {
        type: "ADDED",
        object: {
          metadata: {},
          spec: {},
          status: {},
        } as NodeItem,
      };

      applyNodeEvent(clusterId, event);

      const state = get(nodesStore);
      expect(state[clusterId]).toHaveLength(1);
    });

    it("should handle empty cluster on ADDED", () => {
      const event: NodeWatchEvent = {
        type: "ADDED",
        object: {
          metadata: { name: "node-1" },
          spec: {},
          status: {},
        } as NodeItem,
      };

      applyNodeEvent(clusterId, event);

      const state = get(nodesStore);
      expect(state[clusterId]).toHaveLength(1);
    });

    it("should handle empty cluster on DELETED", () => {
      const event: NodeWatchEvent = {
        type: "DELETED",
        object: {
          metadata: { name: "node-1" },
          spec: {},
          status: {},
        } as NodeItem,
      };

      applyNodeEvent(clusterId, event);

      const state = get(nodesStore);
      expect(state[clusterId]).toHaveLength(0);
    });

    it("should create array for new cluster", () => {
      const event: NodeWatchEvent = {
        type: "ADDED",
        object: {
          metadata: { name: "node-1" },
          spec: {},
          status: {},
        } as NodeItem,
      };

      applyNodeEvent(clusterId, event);

      const state = get(nodesStore);
      expect(state[clusterId]).toBeDefined();
      expect(Array.isArray(state[clusterId])).toBe(true);
    });
  });
});
