import { describe, expect, it } from "vitest";
import type { DaemonSetItem } from "$shared";
import {
  findDaemonSetItem,
  formatDaemonSetNodeSelector,
  getFilteredDaemonSets,
  mapDaemonSetRows,
  pruneSelectedDaemonSetIds,
  toDaemonSetRow,
} from "./model";

function createDaemonSet(
  name: string,
  namespace: string,
  overrides: Partial<DaemonSetItem> = {},
): DaemonSetItem {
  return {
    metadata: {
      name,
      namespace,
      uid: `${namespace}-${name}-uid`,
      creationTimestamp: new Date("2026-01-01T00:00:00Z"),
    },
    spec: {
      selector: { matchLabels: { app: name } },
      template: {
        metadata: {
          labels: { app: name },
        },
        spec: {
          containers: [],
          nodeSelector: {},
        },
      },
    },
    status: {
      currentNumberScheduled: 0,
      numberReady: 0,
      desiredNumberScheduled: 0,
      numberUnavailable: 0,
      numberAvailable: 0,
    },
    ...overrides,
  } as DaemonSetItem;
}

describe("getFilteredDaemonSets", () => {
  const items = [createDaemonSet("a", "default"), createDaemonSet("b", "kube-system")];

  it("returns all items for all namespace", () => {
    expect(getFilteredDaemonSets(items, "all")).toEqual(items);
  });

  it("returns all items for empty namespace", () => {
    expect(getFilteredDaemonSets(items, "")).toEqual(items);
  });

  it("filters by selected namespace", () => {
    expect(getFilteredDaemonSets(items, "kube-system")).toEqual([items[1]]);
  });
});

describe("formatDaemonSetNodeSelector", () => {
  it("returns '-' when selector is absent", () => {
    const item = createDaemonSet("a", "default");
    expect(formatDaemonSetNodeSelector(item)).toBe("-");
  });

  it("formats selector key-value pairs", () => {
    const item = createDaemonSet("a", "default", {
      spec: {
        selector: { matchLabels: { app: "a" } },
        template: {
          metadata: { labels: {} },
          spec: {
            containers: [],
            nodeSelector: { "kubernetes.io/os": "linux", "node-role.kubernetes.io/worker": "1" },
          },
        },
      },
    });

    expect(formatDaemonSetNodeSelector(item)).toBe(
      "kubernetes.io/os=linux, node-role.kubernetes.io/worker=1",
    );
  });
});

describe("toDaemonSetRow and mapDaemonSetRows", () => {
  it("maps daemon set fields and fallback values", () => {
    const item = createDaemonSet("node-exporter", "monitoring", {
      status: {
        desiredNumberScheduled: 12,
        currentNumberScheduled: 12,
        numberReady: 11,
        numberAvailable: 11,
      } as DaemonSetItem["status"],
    });

    const row = toDaemonSetRow(item, () => "5d");
    expect(row).toEqual({
      uid: "monitoring/node-exporter",
      name: "node-exporter",
      namespace: "monitoring",
      nodes: 12,
      desired: 12,
      current: 12,
      ready: 11,
      updated: 0,
      available: 11,
      nodeSelector: "-",
      age: "5d",
      problemScore: 1740,
    });
  });

  it("maps updatedNumberScheduled when present", () => {
    const item = createDaemonSet("ds", "default", {
      status: {
        desiredNumberScheduled: 2,
        currentNumberScheduled: 2,
        numberReady: 2,
        numberAvailable: 2,
        updatedNumberScheduled: 2,
      } as DaemonSetItem["status"] & { updatedNumberScheduled: number },
    });

    expect(mapDaemonSetRows([item], () => "2d")[0]?.updated).toBe(2);
  });
});

describe("findDaemonSetItem", () => {
  it("finds item by namespace and name", () => {
    const items = [createDaemonSet("api", "default"), createDaemonSet("api", "prod")];

    expect(findDaemonSetItem(items, { name: "api", namespace: "prod" })).toEqual(items[1]);
  });

  it("returns undefined when no match exists", () => {
    const items = [createDaemonSet("api", "default")];
    expect(findDaemonSetItem(items, { name: "worker", namespace: "default" })).toBeUndefined();
  });
});

describe("pruneSelectedDaemonSetIds", () => {
  it("keeps selection when all ids are still available", () => {
    const selected = new Set(["a", "b"]);
    const next = pruneSelectedDaemonSetIds(selected, ["a", "b", "c"]);
    expect(next).toBe(selected);
  });

  it("drops ids that are no longer available", () => {
    const selected = new Set(["a", "b"]);
    const next = pruneSelectedDaemonSetIds(selected, ["b", "c"]);
    expect([...next]).toEqual(["b"]);
  });
});
