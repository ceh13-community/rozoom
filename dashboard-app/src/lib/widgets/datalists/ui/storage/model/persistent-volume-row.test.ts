import { describe, expect, it } from "vitest";
import { createPersistentVolumeRows, filterPersistentVolumeRows } from "./persistent-volume-row";

describe("persistent-volume-row model", () => {
  it("adapts PV rows and filters by claim and class", () => {
    const rows = createPersistentVolumeRows([
      {
        metadata: {
          uid: "pv-1",
          name: "pv-fast-001",
          creationTimestamp: "2026-03-01T00:00:00Z",
        },
        spec: {
          storageClassName: "fast",
          capacity: { storage: "100Gi" },
          claimRef: { namespace: "payments", name: "db-data" },
        },
        status: { phase: "Bound" },
      },
    ]);

    expect(rows[0]).toMatchObject({
      uid: "pv-1",
      name: "pv-fast-001",
      storageClass: "fast",
      claim: "payments/db-data",
      phase: "Bound",
      capacity: "100Gi",
    });
    expect(filterPersistentVolumeRows(rows, "payments").map((row) => row.name)).toEqual([
      "pv-fast-001",
    ]);
  });
});
