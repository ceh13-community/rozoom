# Custom Resources - CRD Management

Discover, browse, and manage Custom Resource Definitions (CRDs) and
their instances across the cluster.

---

## Pages

### Custom Resource Definitions List

Displays all CRDs registered in the cluster with:

| Column     | Source                                    |
| ---------- | ----------------------------------------- |
| Name       | `metadata.name`                           |
| Group      | `spec.group`                              |
| Version    | `spec.versions` (count + served versions) |
| Scope      | `spec.scope` (Namespaced / Cluster)       |
| Resource   | `spec.names.plural`                       |
| Conditions | Established, NamesAccepted status         |
| Age        | `metadata.creationTimestamp`              |

**Scoring:** CRDs with 0 versions → +160 (critical - no API schema).

### Instance Browser

When clicking **Browse instances** on a CRD, the app dynamically
queries the cluster for all instances of that custom resource and
displays them in a secondary table with:

- Instance name, namespace, status, age
- Full YAML access per instance
- kubectl describe/get commands

---

## Action Menu

Unified sectioned menu:

| Section         | Actions                                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| **(top)**       | Show details                                                                   |
| **Manifest**    | Edit YAML, Copy kubectl get -o yaml, Copy kubectl describe, Run debug describe |
| **Diagnostics** | Investigate, Browse instances                                                  |
| **Dangerous**   | Delete                                                                         |

Consistent across: row ⋮ menu, details sheet, bulk selection bar.

---

## Details Sheet

Shows CRD-specific fields:

- Group, Version, Scope, Resource
- Versions summary (served/storage versions)
- Conversion strategy summary
- Conditions (Established, NamesAccepted)
- Labels and Annotations

The same CRD details are also shown when accessed via `configuration-list.svelte`
(which provides the table columns and resource renderer).

---

## CRD Renderer (from configuration-list)

Used when CRDs are displayed in the Configuration section:

```
details: "group: cert-manager.io · versions: 1 · scope: Namespaced"
scoreDelta: 0 (or +160 if no versions defined)
```

---

## For Developers

### Architecture

```
$widgets/datalists/ui/custom-resources/
  custom-resources-list.svelte              - Main table (1135 lines)
  custom-resources-actions-menu.svelte      - Row action dropdown (sectioned)
  custom-resources-bulk-actions.svelte      - Bulk selection toolbar
  custom-resources-details-sheet.svelte     - Side panel details
  custom-resources-workbench-panel.svelte   - YAML workbench
  model/
    custom-resources-row-adapter.ts         - CRD row mapping
    custom-resources-row.ts                 - Row type definition
    custom-resource-instance-row.ts         - Instance row mapping

Also rendered via configuration-list.svelte with:
  configuration-list/model/resource-renderers.ts → customresourcedefinitions renderer
```

### K8s API Reference

CRDs use the `apiextensions.k8s.io/v1` API group:

- `kubectl get crd` - list all CRDs
- `kubectl get <resource>.<group>` - list instances of a specific CRD
- `kubectl describe crd <name>` - detailed CRD info including conditions
- `spec.versions[].served` - whether this version is served by the API
- `spec.versions[].storage` - which version is used for storage
- `status.conditions[].type` - Established (API serving), NamesAccepted (no conflicts)
