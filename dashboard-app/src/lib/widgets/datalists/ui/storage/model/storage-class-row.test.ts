import { describe, expect, it } from "vitest";
import { createStorageClassRows, filterStorageClassRows } from "./storage-class-row";

describe("storage-class-row model", () => {
  it("adapts storage class rows and filters by binding mode and summary", () => {
    const rows = createStorageClassRows([
      {
        metadata: {
          uid: "sc-1",
          name: "fast",
          creationTimestamp: "2026-03-01T00:00:00Z",
        },
        volumeBindingMode: "WaitForFirstConsumer",
        reclaimPolicy: "Delete",
      },
    ]);

    expect(rows[0]).toMatchObject({
      uid: "sc-1",
      name: "fast",
      kind: "StorageClass",
      capacity: "WaitForFirstConsumer",
      phase: "Active",
    });
    expect(filterStorageClassRows(rows, "waitforfirstconsumer").map((row) => row.name)).toEqual([
      "fast",
    ]);
  });
});
