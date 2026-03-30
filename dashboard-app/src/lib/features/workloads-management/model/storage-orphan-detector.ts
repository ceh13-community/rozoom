/**
 * Orphan PV/PVC/Snapshot Detector
 *
 * Finds storage resources that are no longer bound or referenced:
 * - PVs without claims (Released/Available)
 * - PVCs not mounted by any pod
 * - VolumeSnapshots with missing source PVCs
 */

type GenericItem = Record<string, unknown>;

export type OrphanResource = {
  kind: "PersistentVolume" | "PersistentVolumeClaim" | "VolumeSnapshot";
  name: string;
  namespace: string;
  reason: string;
  age: string;
  capacity: string;
  storageClass: string;
};

export type OrphanReport = {
  orphans: OrphanResource[];
  totalPVs: number;
  totalPVCs: number;
  totalSnapshots: number;
  reclaimableCapacity: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseCapacityBytes(capacity: string): number {
  const match = capacity.match(/^(\d+(?:\.\d+)?)\s*(Ki|Mi|Gi|Ti|Pi)?$/);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- capture group may not match
  const unit = match[2] ?? "";
  const multipliers: Record<string, number> = {
    "": 1,
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
  };
  return value * (multipliers[unit] ?? 1);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)}Ki`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)}Mi`;
  return `${(bytes / 1024 ** 3).toFixed(1)}Gi`;
}

function getAge(item: GenericItem): string {
  const ts = asString(asRecord(item.metadata).creationTimestamp);
  if (!ts) return "-";
  const diffMs = Date.now() - new Date(ts).getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diffMs / 3600000);
  return hours > 0 ? `${hours}h` : "<1h";
}

export function detectOrphanResources(input: {
  pvs: GenericItem[];
  pvcs: GenericItem[];
  pods: GenericItem[];
  snapshots?: GenericItem[];
}): OrphanReport {
  const orphans: OrphanResource[] = [];

  // 1. PVs not bound
  for (const pv of input.pvs) {
    const status = asRecord(pv.status);
    const phase = asString(status.phase, "Unknown");
    const spec = asRecord(pv.spec);
    if (phase !== "Bound") {
      orphans.push({
        kind: "PersistentVolume",
        name: asString(asRecord(pv.metadata).name),
        namespace: "cluster",
        reason: `Phase: ${phase} (not bound to any claim)`,
        age: getAge(pv),
        capacity: asString(asRecord(spec.capacity).storage),
        storageClass: asString(spec.storageClassName),
      });
    }
  }

  // 2. PVCs not mounted by any pod
  const mountedPvcNames = new Set<string>();
  for (const pod of input.pods) {
    const spec = asRecord(pod.spec);
    for (const volume of asArray(spec.volumes)) {
      const vol = asRecord(volume);
      const pvcName = asString(asRecord(vol.persistentVolumeClaim).claimName);
      if (pvcName) {
        const ns = asString(asRecord(pod.metadata).namespace);
        mountedPvcNames.add(`${ns}/${pvcName}`);
      }
    }
  }

  for (const pvc of input.pvcs) {
    const metadata = asRecord(pvc.metadata);
    const ns = asString(metadata.namespace);
    const name = asString(metadata.name);
    const key = `${ns}/${name}`;
    const phase = asString(asRecord(pvc.status).phase, "Unknown");
    if (phase === "Bound" && !mountedPvcNames.has(key)) {
      orphans.push({
        kind: "PersistentVolumeClaim",
        name,
        namespace: ns,
        reason: "Bound but not mounted by any pod",
        age: getAge(pvc),
        capacity: asString(asRecord(asRecord(pvc.status).capacity).storage),
        storageClass: asString(asRecord(pvc.spec).storageClassName),
      });
    }
  }

  // 3. VolumeSnapshots with missing source PVC
  const existingPvcKeys = new Set(
    input.pvcs.map((pvc) => {
      const m = asRecord(pvc.metadata);
      return `${asString(m.namespace)}/${asString(m.name)}`;
    }),
  );

  for (const snap of input.snapshots ?? []) {
    const metadata = asRecord(snap.metadata);
    const spec = asRecord(snap.spec);
    const source = asRecord(spec.source);
    const sourcePvc = asString(source.persistentVolumeClaimName);
    const ns = asString(metadata.namespace);
    if (sourcePvc && !existingPvcKeys.has(`${ns}/${sourcePvc}`)) {
      orphans.push({
        kind: "VolumeSnapshot",
        name: asString(metadata.name),
        namespace: ns,
        reason: `Source PVC "${sourcePvc}" no longer exists`,
        age: getAge(snap),
        capacity: asString(asRecord(asRecord(snap.status).restoreSize)),
        storageClass: asString(spec.volumeSnapshotClassName),
      });
    }
  }

  // Calculate reclaimable capacity
  let reclaimableBytes = 0;
  for (const orphan of orphans) {
    reclaimableBytes += parseCapacityBytes(orphan.capacity);
  }

  return {
    orphans,
    totalPVs: input.pvs.length,
    totalPVCs: input.pvcs.length,
    totalSnapshots: (input.snapshots ?? []).length,
    reclaimableCapacity: formatBytes(reclaimableBytes),
  };
}
