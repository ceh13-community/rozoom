import { describe, it, expect, vi, beforeEach } from "vitest";
import { updateNodeHealth } from "./node-health-updater";
import { nodesStore } from "./nodes-store";
import { updateClusterCheckPartially } from "../../cache-store";
import { parseNodes } from "$features/check-health/api/parsers";
import type { NodeItem, NodeMetadata, NodeStatus } from "$shared/model/clusters";

vi.mock("./nodes-store", () => ({
  nodesStore: {
    subscribe: vi.fn(),
  },
}));

vi.mock("../../cache-store", () => ({
  updateClusterCheckPartially: vi.fn(),
}));

vi.mock("@/lib/features/check-health/api/parsers", () => ({
  parseNodes: vi.fn(),
}));

vi.mock("svelte/store", () => ({
  get: vi.fn(),
}));

import { get } from "svelte/store";

describe("updateNodeHealth", () => {
  const clusterId = "test-cluster-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return early if no nodes exist for cluster", async () => {
    vi.mocked(get).mockReturnValue({});

    await updateNodeHealth(clusterId);

    expect(parseNodes).not.toHaveBeenCalled();
    expect(updateClusterCheckPartially).not.toHaveBeenCalled();
  });

  it("should return early if nodes array is empty", async () => {
    vi.mocked(get).mockReturnValue({
      [clusterId]: [],
    });

    await updateNodeHealth(clusterId);

    expect(parseNodes).not.toHaveBeenCalled();
    expect(updateClusterCheckPartially).not.toHaveBeenCalled();
  });

  it("should parse nodes and update health check when nodes exist", async () => {
    const mockNodes: Partial<NodeItem>[] = [
      {
        metadata: {
          name: "node-1",
          namespace: "default",
          creationTimestamp: "2022-01-01T00:00:00Z",
        },
        status: {
          conditions: [{ type: "Ready", status: "True" }],
        } as NodeStatus,
      },
      {
        metadata: {
          name: "node-2",
          namespace: "default",
          creationTimestamp: "2022-01-01T00:00:00Z",
        },
        status: {
          conditions: [{ type: "Ready", status: "False" }],
        } as NodeStatus,
      },
    ];

    const parsedNodesResult = {
      checks: [],
      summary: {
        className: "green",
        status: "Ok",
        count: {
          total: 2,
          ready: 1,
        },
      },
    };

    vi.mocked(get).mockReturnValue({
      [clusterId]: mockNodes,
    });

    vi.mocked(parseNodes).mockReturnValue(parsedNodesResult);

    await updateNodeHealth(clusterId);

    expect(get).toHaveBeenCalledWith(nodesStore);
    expect(parseNodes).toHaveBeenCalledWith({ items: mockNodes });
    expect(updateClusterCheckPartially).toHaveBeenCalledWith(clusterId, {
      nodes: parsedNodesResult,
    });
  });

  it("should handle single node", async () => {
    const mockNode: Partial<NodeItem> = {
      metadata: { name: "node-1", namespace: "default" } as NodeMetadata,
      status: {
        conditions: [{ type: "Ready", status: "True" }],
      } as NodeStatus,
    };

    const parsedNodesResult = {
      checks: [],
      summary: {
        className: "green",
        status: "Ok",
        count: {
          total: 2,
          ready: 1,
        },
      },
    };

    vi.mocked(get).mockReturnValue({
      [clusterId]: [mockNode],
    });

    vi.mocked(parseNodes).mockReturnValue(parsedNodesResult);

    await updateNodeHealth(clusterId);

    expect(parseNodes).toHaveBeenCalledWith({ items: [mockNode] });
    expect(updateClusterCheckPartially).toHaveBeenCalledWith(clusterId, {
      nodes: parsedNodesResult,
    });
  });

  it("should handle multiple clusters with different nodes", async () => {
    const cluster1Nodes: Partial<NodeItem>[] = [{ metadata: { name: "node-1" } as NodeMetadata }];

    const cluster2Nodes: Partial<NodeItem>[] = [
      { metadata: { name: "node-2" } as NodeMetadata },
      { metadata: { name: "node-3" } as NodeMetadata },
    ];

    const parsedResult1 = {
      checks: [],
      summary: {
        className: "green",
        status: "Ok",
        count: {
          total: 1,
          ready: 1,
        },
      },
    };
    const parsedResult2 = {
      checks: [],
      summary: {
        className: "green",
        status: "Ok",
        count: {
          total: 2,
          ready: 2,
        },
      },
    };

    vi.mocked(get).mockReturnValueOnce({
      "cluster-1": cluster1Nodes,
      "cluster-2": cluster2Nodes,
    });

    vi.mocked(parseNodes).mockReturnValueOnce(parsedResult1);

    await updateNodeHealth("cluster-1");

    expect(parseNodes).toHaveBeenCalledWith({ items: cluster1Nodes });
    expect(updateClusterCheckPartially).toHaveBeenCalledWith("cluster-1", {
      nodes: parsedResult1,
    });

    vi.mocked(get).mockReturnValueOnce({
      "cluster-1": cluster1Nodes,
      "cluster-2": cluster2Nodes,
    });

    vi.mocked(parseNodes).mockReturnValueOnce(parsedResult2);

    await updateNodeHealth("cluster-2");

    expect(parseNodes).toHaveBeenCalledWith({ items: cluster2Nodes });
    expect(updateClusterCheckPartially).toHaveBeenCalledWith("cluster-2", {
      nodes: parsedResult2,
    });
  });

  it("should handle nodes with various statuses", async () => {
    const mockNodes: Partial<NodeItem>[] = [
      {
        metadata: { name: "ready-node", namespace: "default" } as NodeMetadata,
        status: {
          conditions: [{ type: "Ready", status: "True" }],
        } as NodeStatus,
      },
      {
        metadata: { name: "not-ready-node", namespace: "default" } as NodeMetadata,
        status: {
          conditions: [{ type: "Ready", status: "False" }],
        } as NodeStatus,
      },
      {
        metadata: { name: "unknown-node", namespace: "default" } as NodeMetadata,
        status: {
          conditions: [{ type: "Ready", status: "Unknown" }],
        } as NodeStatus,
      },
    ];

    const parsedNodesResult = {
      checks: [],
      summary: {
        className: "green",
        status: "Ok",
        count: {
          total: 3,
          ready: 1,
        },
      },
    };

    vi.mocked(get).mockReturnValue({
      [clusterId]: mockNodes,
    });

    vi.mocked(parseNodes).mockReturnValue(parsedNodesResult);

    await updateNodeHealth(clusterId);

    expect(parseNodes).toHaveBeenCalledWith({ items: mockNodes });
    expect(updateClusterCheckPartially).toHaveBeenCalledWith(clusterId, {
      nodes: parsedNodesResult,
    });
  });

  it("should pass nodes as NodeItem[] type to parseNodes", async () => {
    const mockNodes: Partial<NodeItem>[] = [{ metadata: { name: "node-1" } as NodeMetadata }];

    vi.mocked(get).mockReturnValue({
      [clusterId]: mockNodes,
    });

    vi.mocked(parseNodes).mockReturnValue({
      checks: [],
      summary: {
        className: "green",
        status: "Ok",
        count: {
          total: 1,
          ready: 1,
        },
      },
    });

    await updateNodeHealth(clusterId);

    expect(parseNodes).toHaveBeenCalledWith({
      items: expect.any(Array),
    });
  });

  it("should handle parseNodes returning zero nodes", async () => {
    const mockNodes: Partial<NodeItem>[] = [{ metadata: { name: "node-1" } as NodeMetadata }];

    const parsedNodesResult = {
      checks: [],
      summary: {
        className: "green",
        status: "Ok",
        count: {
          total: 0,
          ready: 0,
        },
      },
    };

    vi.mocked(get).mockReturnValue({
      [clusterId]: mockNodes,
    });

    vi.mocked(parseNodes).mockReturnValue(parsedNodesResult);

    await updateNodeHealth(clusterId);

    expect(updateClusterCheckPartially).toHaveBeenCalledWith(clusterId, {
      nodes: parsedNodesResult,
    });
  });

  it("should await updateClusterCheckPartially completion", async () => {
    const mockNodes: Partial<NodeItem>[] = [{ metadata: { name: "node-1" } as NodeMetadata }];

    vi.mocked(get).mockReturnValue({
      [clusterId]: mockNodes,
    });

    vi.mocked(parseNodes).mockReturnValue({
      checks: [],
      summary: {
        className: "green",
        status: "Ok",
        count: {
          total: 1,
          ready: 1,
        },
      },
    });

    const updatePromise = Promise.resolve();
    vi.mocked(updateClusterCheckPartially).mockReturnValue(updatePromise);

    await updateNodeHealth(clusterId);

    expect(updateClusterCheckPartially).toHaveBeenCalled();
    await expect(updatePromise).resolves.toBeUndefined();
  });

  it("should propagate errors from updateClusterCheckPartially", async () => {
    const mockNodes: Partial<NodeItem>[] = [{ metadata: { name: "node-1" } as NodeMetadata }];

    vi.mocked(get).mockReturnValue({
      [clusterId]: mockNodes,
    });

    vi.mocked(parseNodes).mockReturnValue({
      checks: [],
      summary: {
        className: "green",
        status: "Ok",
        count: {
          total: 1,
          ready: 1,
        },
      },
    });

    const error = new Error("Update failed");
    vi.mocked(updateClusterCheckPartially).mockRejectedValue(error);

    await expect(updateNodeHealth(clusterId)).rejects.toThrow("Update failed");
  });

  it("should propagate errors from parseNodes", async () => {
    const mockNodes: Partial<NodeItem>[] = [{ metadata: { name: "node-1" } as NodeMetadata }];

    vi.mocked(get).mockReturnValue({
      [clusterId]: mockNodes,
    });

    const error = new Error("Parse failed");
    vi.mocked(parseNodes).mockImplementation(() => {
      throw error;
    });

    await expect(updateNodeHealth(clusterId)).rejects.toThrow("Parse failed");
  });

  it("should handle nodes store returning undefined for cluster", async () => {
    vi.mocked(get).mockReturnValue({
      "other-cluster": [{ metadata: { name: "node-1" } }],
    });

    await updateNodeHealth(clusterId);

    expect(parseNodes).not.toHaveBeenCalled();
    expect(updateClusterCheckPartially).not.toHaveBeenCalled();
  });
});
