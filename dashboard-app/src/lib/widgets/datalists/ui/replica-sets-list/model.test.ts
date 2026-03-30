import { describe, expect, it } from "vitest";
import type { ReplicaSetItem } from "$shared/model/clusters";
import {
  findReplicaSetItem,
  getFilteredReplicaSets,
  mapReplicaSetRows,
  pruneSelectedReplicaSetIds,
  toReplicaSetRow,
} from "./model";

const baseItem = {
  metadata: {
    name: "api-rs",
    namespace: "apps",
    creationTimestamp: new Date("2026-01-01T00:00:00Z"),
  },
  spec: {
    replicas: 4,
  },
  status: {
    replicas: 4,
    availableReplicas: 3,
    readyReplicas: 2,
  },
} as unknown as ReplicaSetItem;

describe("getFilteredReplicaSets", () => {
  it("returns all items when namespace is all", () => {
    expect(getFilteredReplicaSets([baseItem], "all")).toHaveLength(1);
    expect(getFilteredReplicaSets([baseItem], null)).toHaveLength(1);
  });

  it("filters by namespace", () => {
    expect(getFilteredReplicaSets([baseItem], "apps")).toHaveLength(1);
    expect(getFilteredReplicaSets([baseItem], "kube-system")).toHaveLength(0);
  });
});

describe("toReplicaSetRow", () => {
  it("maps regular item values", () => {
    const row = toReplicaSetRow(baseItem, () => "1d");
    expect(row).toEqual({
      uid: "apps/api-rs",
      name: "api-rs",
      namespace: "apps",
      desired: 4,
      current: 4,
      ready: 2,
      age: "1d",
      problemScore: 340,
    });
  });

  it("is runtime-safe for sparse items", () => {
    const sparse = { metadata: {}, status: {} } as unknown as ReplicaSetItem;
    const row = toReplicaSetRow(sparse, () => "-");
    expect(row).toEqual({
      uid: "default/-",
      name: "-",
      namespace: "default",
      desired: 0,
      current: 0,
      ready: 0,
      age: "-",
      problemScore: 0,
    });
  });
});

describe("map/find replica set rows", () => {
  it("maps rows and finds item by row keys", () => {
    const rows = mapReplicaSetRows([baseItem], () => "age");
    expect(rows).toHaveLength(1);
    const found = findReplicaSetItem([baseItem], { name: "api-rs", namespace: "apps" });
    expect(found).toBe(baseItem);
  });
});

describe("pruneSelectedReplicaSetIds", () => {
  it("keeps only ids present in available ids", () => {
    const selected = new Set(["apps/api-rs", "apps/old"]);
    const pruned = pruneSelectedReplicaSetIds(selected, ["apps/api-rs"]);
    expect([...pruned]).toEqual(["apps/api-rs"]);
  });

  it("returns the same set when nothing changes", () => {
    const selected = new Set(["apps/api-rs"]);
    const pruned = pruneSelectedReplicaSetIds(selected, ["apps/api-rs", "apps/other"]);
    expect(pruned).toBe(selected);
  });
});
