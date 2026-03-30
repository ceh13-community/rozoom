import { describe, expect, it } from "vitest";
import type { StatefulSetItem } from "$shared/model/clusters";
import {
  findStatefulSetItem,
  getFilteredStatefulSets,
  mapStatefulSetRows,
  pruneSelectedStatefulSetIds,
  toStatefulSetRow,
} from "./model";

const baseItem = {
  metadata: {
    name: "web",
    namespace: "apps",
    creationTimestamp: new Date("2026-01-01T00:00:00Z"),
  },
  spec: {
    replicas: 3,
    selector: { matchLabels: { app: "web" } },
    template: {
      metadata: { labels: { app: "web" } },
      spec: { containers: [] },
    },
  },
  status: {
    replicas: 3,
    readyReplicas: 2,
    updatedReplicas: 3,
    availableReplicas: 2,
  },
} as unknown as StatefulSetItem;

describe("getFilteredStatefulSets", () => {
  it("returns all items when namespace is all", () => {
    expect(getFilteredStatefulSets([baseItem], "all")).toHaveLength(1);
    expect(getFilteredStatefulSets([baseItem], null)).toHaveLength(1);
  });

  it("filters by namespace", () => {
    expect(getFilteredStatefulSets([baseItem], "apps")).toHaveLength(1);
    expect(getFilteredStatefulSets([baseItem], "kube-system")).toHaveLength(0);
  });
});

describe("toStatefulSetRow", () => {
  it("maps regular item values", () => {
    const row = toStatefulSetRow(baseItem, () => "1d");
    expect(row).toEqual({
      uid: "apps/web",
      name: "web",
      namespace: "apps",
      pods: "2/3",
      replicas: 3,
      age: "1d",
      problemScore: 170,
    });
  });

  it("is runtime-safe for sparse items", () => {
    const sparse = { metadata: {}, spec: {}, status: {} } as unknown as StatefulSetItem;
    const row = toStatefulSetRow(sparse, () => "-");
    expect(row).toEqual({
      uid: "default/-",
      name: "-",
      namespace: "default",
      pods: "0/0",
      replicas: 0,
      age: "-",
      problemScore: 0,
    });
  });
});

describe("map/find stateful set rows", () => {
  it("maps rows and finds item by row keys", () => {
    const rows = mapStatefulSetRows([baseItem], () => "age");
    expect(rows).toHaveLength(1);
    const found = findStatefulSetItem([baseItem], { name: "web", namespace: "apps" });
    expect(found).toBe(baseItem);
  });
});

describe("pruneSelectedStatefulSetIds", () => {
  it("keeps only ids present in available ids", () => {
    const selected = new Set(["apps/web", "apps/old"]);
    const pruned = pruneSelectedStatefulSetIds(selected, ["apps/web"]);
    expect([...pruned]).toEqual(["apps/web"]);
  });

  it("returns the same set when nothing changes", () => {
    const selected = new Set(["apps/web"]);
    const pruned = pruneSelectedStatefulSetIds(selected, ["apps/web", "apps/other"]);
    expect(pruned).toBe(selected);
  });
});
