import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listRecentClusters,
  markRecentCluster,
  resetRecentClusters,
  resolveWarmClusterCandidates,
} from "./cluster-runtime-recency";

describe("cluster-runtime-recency", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetRecentClusters();
    vi.useRealTimers();
  });

  it("keeps recent clusters ordered by most recent visit", () => {
    markRecentCluster("cluster-a", 100);
    markRecentCluster("cluster-b", 200);
    markRecentCluster("cluster-a", 300);

    expect(listRecentClusters()).toEqual(["cluster-a", "cluster-b"]);
  });

  it("resolves warm clusters from pinned-first then recent candidates", () => {
    markRecentCluster("cluster-c", 100);
    markRecentCluster("cluster-d", 200);
    markRecentCluster("cluster-b", 300);

    expect(
      resolveWarmClusterCandidates({
        activeClusterId: "cluster-a",
        pinnedClusterIds: ["cluster-b", "cluster-a", "cluster-b"],
        maxWarmClusters: 3,
      }),
    ).toEqual(["cluster-b", "cluster-d", "cluster-c"]);
  });

  it("respects the configured warm-cluster cap", () => {
    markRecentCluster("cluster-b", 100);
    markRecentCluster("cluster-c", 200);

    expect(
      resolveWarmClusterCandidates({
        activeClusterId: "cluster-a",
        pinnedClusterIds: [],
        maxWarmClusters: 1,
      }),
    ).toEqual(["cluster-c"]);
  });
});
