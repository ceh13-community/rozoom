import { describe, expect, it } from "vitest";
import type { JobItem } from "$shared/model/clusters";
import { findJobItem, getFilteredJobs, mapJobRows, pruneSelectedJobIds, toJobRow } from "./model";

const baseItem = {
  metadata: {
    name: "backup-job",
    namespace: "ops",
    creationTimestamp: new Date("2026-01-01T00:00:00Z"),
  },
  spec: { completions: 2 },
  status: { succeeded: 1, conditions: [{ type: "Complete" }] },
} as unknown as JobItem;

describe("getFilteredJobs", () => {
  it("returns all items when namespace is all", () => {
    expect(getFilteredJobs([baseItem], "all")).toHaveLength(1);
    expect(getFilteredJobs([baseItem], null)).toHaveLength(1);
  });

  it("filters by namespace", () => {
    expect(getFilteredJobs([baseItem], "ops")).toHaveLength(1);
    expect(getFilteredJobs([baseItem], "apps")).toHaveLength(0);
  });
});

describe("toJobRow", () => {
  it("maps regular item values", () => {
    const row = toJobRow(baseItem, () => "1d");
    expect(row).toEqual({
      uid: "ops/backup-job",
      name: "backup-job",
      namespace: "ops",
      completions: "1/2",
      age: "1d",
      status: "Complete",
      problemScore: 120,
    });
  });

  it("is runtime-safe for sparse items", () => {
    const sparse = { metadata: {}, spec: {}, status: {} } as unknown as JobItem;
    const row = toJobRow(sparse, () => "-");
    expect(row).toEqual({
      uid: "default/-",
      name: "-",
      namespace: "default",
      completions: "0/0",
      age: "-",
      status: "-",
      problemScore: 80,
    });
  });
});

describe("map/find job rows", () => {
  it("maps rows and finds item by row keys", () => {
    const rows = mapJobRows([baseItem], () => "age");
    expect(rows).toHaveLength(1);
    const found = findJobItem([baseItem], { name: "backup-job", namespace: "ops" });
    expect(found).toBe(baseItem);
  });
});

describe("pruneSelectedJobIds", () => {
  it("keeps only ids present in available ids", () => {
    const selected = new Set(["ops/backup-job", "ops/old"]);
    const pruned = pruneSelectedJobIds(selected, ["ops/backup-job"]);
    expect([...pruned]).toEqual(["ops/backup-job"]);
  });

  it("returns the same set when nothing changes", () => {
    const selected = new Set(["ops/backup-job"]);
    const pruned = pruneSelectedJobIds(selected, ["ops/backup-job", "ops/other"]);
    expect(pruned).toBe(selected);
  });
});
