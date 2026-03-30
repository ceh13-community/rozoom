import { describe, expect, it } from "vitest";
import { detectOrphanResources } from "./storage-orphan-detector";

describe("storage-orphan-detector", () => {
  it("detects unbound PVs", () => {
    const result = detectOrphanResources({
      pvs: [
        {
          metadata: { name: "pv-1" },
          status: { phase: "Released" },
          spec: { capacity: { storage: "10Gi" }, storageClassName: "standard" },
        },
        {
          metadata: { name: "pv-2" },
          status: { phase: "Bound" },
          spec: { capacity: { storage: "5Gi" } },
        },
      ],
      pvcs: [],
      pods: [],
    });
    expect(result.orphans).toHaveLength(1);
    expect(result.orphans[0].name).toBe("pv-1");
    expect(result.orphans[0].reason).toContain("Released");
  });

  it("detects PVCs not mounted by any pod", () => {
    const result = detectOrphanResources({
      pvs: [],
      pvcs: [
        {
          metadata: { name: "data-pvc", namespace: "default" },
          status: { phase: "Bound", capacity: { storage: "20Gi" } },
          spec: { storageClassName: "fast" },
        },
      ],
      pods: [
        {
          metadata: { namespace: "default" },
          spec: { volumes: [{ persistentVolumeClaim: { claimName: "other-pvc" } }] },
        },
      ],
    });
    expect(result.orphans).toHaveLength(1);
    expect(result.orphans[0].kind).toBe("PersistentVolumeClaim");
    expect(result.orphans[0].reason).toContain("not mounted");
  });

  it("does not flag PVCs mounted by pods", () => {
    const result = detectOrphanResources({
      pvs: [],
      pvcs: [
        {
          metadata: { name: "data-pvc", namespace: "default" },
          status: { phase: "Bound" },
          spec: {},
        },
      ],
      pods: [
        {
          metadata: { namespace: "default" },
          spec: { volumes: [{ persistentVolumeClaim: { claimName: "data-pvc" } }] },
        },
      ],
    });
    expect(result.orphans).toHaveLength(0);
  });

  it("detects snapshots with missing source PVC", () => {
    const result = detectOrphanResources({
      pvs: [],
      pvcs: [],
      pods: [],
      snapshots: [
        {
          metadata: { name: "snap-1", namespace: "default" },
          spec: { source: { persistentVolumeClaimName: "deleted-pvc" } },
          status: {},
        },
      ],
    });
    expect(result.orphans).toHaveLength(1);
    expect(result.orphans[0].kind).toBe("VolumeSnapshot");
    expect(result.orphans[0].reason).toContain("deleted-pvc");
  });

  it("calculates reclaimable capacity", () => {
    const result = detectOrphanResources({
      pvs: [
        {
          metadata: { name: "pv-1" },
          status: { phase: "Available" },
          spec: { capacity: { storage: "100Gi" } },
        },
      ],
      pvcs: [],
      pods: [],
    });
    expect(result.reclaimableCapacity).toBe("100.0Gi");
  });
});
