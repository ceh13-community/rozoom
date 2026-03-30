import { describe, expect, it } from "vitest";
import type { CronJobItem } from "$shared/model/clusters";
import {
  findCronJobItem,
  getFilteredCronJobs,
  mapCronJobRows,
  pruneSelectedCronJobIds,
  toCronJobRow,
} from "./model";

const baseItem = {
  metadata: {
    name: "nightly",
    namespace: "ops",
    creationTimestamp: new Date("2026-01-01T00:00:00Z"),
  },
  spec: {
    schedule: "0 1 * * *",
    suspend: false,
    timeZone: "UTC",
  },
  status: {
    active: [{ name: "nightly-1" }],
    lastScheduleTime: new Date("2026-01-02T01:00:00Z"),
    nextScheduleTime: new Date("2026-01-02T13:00:00Z"),
  },
} as unknown as CronJobItem;

describe("getFilteredCronJobs", () => {
  it("returns all items when namespace is all", () => {
    expect(getFilteredCronJobs([baseItem], "all")).toHaveLength(1);
    expect(getFilteredCronJobs([baseItem], null)).toHaveLength(1);
  });

  it("filters by namespace", () => {
    expect(getFilteredCronJobs([baseItem], "ops")).toHaveLength(1);
    expect(getFilteredCronJobs([baseItem], "apps")).toHaveLength(0);
  });
});

describe("toCronJobRow", () => {
  it("maps regular item values", () => {
    const row = toCronJobRow(
      baseItem,
      () => "7d",
      () => "1d",
      () => "2026-01-02T13:00:00.000Z",
    );
    expect(row).toEqual({
      uid: "ops/nightly",
      name: "nightly",
      namespace: "ops",
      schedule: "0 1 * * *",
      suspend: "No",
      active: 1,
      lastSchedule: "1d",
      nextExecution: "2026-01-02T13:00:00.000Z",
      timeZone: "UTC",
      age: "7d",
      problemScore: 40,
    });
  });

  it("is runtime-safe for sparse items", () => {
    const sparse = { metadata: {}, spec: {}, status: {} } as unknown as CronJobItem;
    const row = toCronJobRow(
      sparse,
      () => "-",
      () => "-",
      () => "-",
    );
    expect(row).toEqual({
      uid: "default/-",
      name: "-",
      namespace: "default",
      schedule: "-",
      suspend: "No",
      active: 0,
      lastSchedule: "-",
      nextExecution: "-",
      timeZone: "-",
      age: "-",
      problemScore: 200,
    });
  });
});

describe("map/find cron job rows", () => {
  it("maps rows and finds item by row keys", () => {
    const rows = mapCronJobRows(
      [baseItem],
      () => "age",
      () => "last",
      () => "next",
    );
    expect(rows).toHaveLength(1);
    const found = findCronJobItem([baseItem], { name: "nightly", namespace: "ops" });
    expect(found).toBe(baseItem);
  });
});

describe("pruneSelectedCronJobIds", () => {
  it("keeps only ids present in available ids", () => {
    const selected = new Set(["ops/nightly", "ops/old"]);
    const pruned = pruneSelectedCronJobIds(selected, ["ops/nightly"]);
    expect([...pruned]).toEqual(["ops/nightly"]);
  });

  it("returns the same set when nothing changes", () => {
    const selected = new Set(["ops/nightly"]);
    const pruned = pruneSelectedCronJobIds(selected, ["ops/nightly", "ops/other"]);
    expect(pruned).toBe(selected);
  });
});
