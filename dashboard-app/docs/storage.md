# Storage - Persistent Volume & Snapshot Management

Manages Kubernetes storage lifecycle: volumes, claims, storage classes,
snapshots, and CSI capacity tracking.

---

## Pages

### Core Storage (via `configuration-list.svelte`)

| Resource                     | Key Columns                                            | Scoring                                  |
| ---------------------------- | ------------------------------------------------------ | ---------------------------------------- |
| **Persistent Volume Claims** | Name, Namespace, StorageClass, Size, Pods, Status, Age | Not bound: +220                          |
| **Persistent Volumes**       | Name, StorageClass, Capacity, Claim, Status, Age       | Not bound: +220                          |
| **Storage Classes**          | Name, Provisioner, ReclaimPolicy, Default, Age         | No provisioner: +200; dup defaults: +180 |

### Volume Snapshots (optional, via `configuration-list.svelte`)

| Resource                     | Key Columns                                                         | Scoring                             |
| ---------------------------- | ------------------------------------------------------------------- | ----------------------------------- |
| **Volume Snapshots**         | Name, Namespace, SnapshotClass, RestoreSize, Status, Age            | Not ready: +220                     |
| **Volume Snapshot Contents** | Name, SnapshotRef, Driver, DeletionPolicy, RestoreSize, Status, Age | Not ready: +220; error: +80         |
| **Volume Snapshot Classes**  | Name, Driver, DeletionPolicy, Default, Age                          | No driver: +180; dup defaults: +180 |

Volume snapshot resources are auto-discovered via `kubectl api-resources`
and hidden if the cluster doesn't have snapshot CRDs installed.

### CSI (via `configuration-list.svelte`)

| Resource                      | Key Columns                       | Scoring           |
| ----------------------------- | --------------------------------- | ----------------- |
| **Volume Attributes Classes** | Name, Driver, Age                 | No driver: +180   |
| **CSI Storage Capacities**    | Name, StorageClass, Capacity, Age | No capacity: +140 |

---

## Action Menu

Unified sectioned menu:

| Section         | Actions                                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| **(top)**       | Show details                                                                   |
| **Manifest**    | Edit YAML, Copy kubectl get -o yaml, Copy kubectl describe, Run debug describe |
| **Diagnostics** | Investigate (optional)                                                         |
| **Dangerous**   | Delete                                                                         |

Consistent across: row ⋮ menu, details sheet, bulk selection bar.

---

## Details Sheet

Shows storage-specific fields:

- Namespace, Kind, StorageClass, Phase, Capacity, Claim
- Summary (renderer output)
- Labels, Annotations
- **PVC Disk Usage** - real-time used/total bar from kubelet stats summary API (green/amber/red)
- **Traffic Chain** - PVC -> Pod (mounted by), PV -> bound PVC, StorageClass -> PVCs count

Additional fields per resource type (via `configuration-list.svelte`):

- **PVCs**: StorageClass, Size, Pods, Status
- **PVs**: StorageClass, Capacity, Claim, Status
- **StorageClasses**: Provisioner, Reclaim policy, Default
- **VolumeSnapshots**: SnapshotClass, RestoreSize, Status
- **VolumeSnapshotContents**: SnapshotRef, Driver, DeletionPolicy, RestoreSize, Status
- **VolumeSnapshotClasses**: Driver, DeletionPolicy, Default
- **CSIStorageCapacities**: StorageClass, Capacity

---

## For Developers

### Architecture

```
$widgets/datalists/ui/storage/
  storage-list.svelte                    - Dedicated table (420 lines)
  storage-actions-menu.svelte            - Row action dropdown (sectioned)
  storage-bulk-actions.svelte            - Bulk selection toolbar
  storage-details-sheet.svelte           - Side panel details
  storage-workbench-panel.svelte         - YAML workbench
  persistent-volumes-list.svelte         - PV-specific columns
  storage-classes-list.svelte            - SC-specific columns
  model/
    storage-row-adapter.ts               - Row type + data mapping
    storage-row.ts                       - Row type definition
    storage-class-row.ts                 - SC row type
    persistent-volume-row.ts             - PV row type

Also rendered via configuration-list.svelte with dedicated renderers
and custom detail fields per resource type.
```

### K8s API Reference

- PVCs: `v1` core - `kubectl get pvc`
- PVs: `v1` core - `kubectl get pv`
- StorageClasses: `storage.k8s.io/v1` - `kubectl get sc`
- VolumeSnapshots: `snapshot.storage.k8s.io/v1` - optional CRDs
- VolumeSnapshotContents: `snapshot.storage.k8s.io/v1` - optional CRDs
- VolumeSnapshotClasses: `snapshot.storage.k8s.io/v1` - optional CRDs
- VolumeAttributesClasses: `storage.k8s.io/v1beta1` - optional
- CSIStorageCapacities: `storage.k8s.io/v1` - `kubectl get csistoragecapacity`
