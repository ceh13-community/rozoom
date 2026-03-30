# Configuration - Resource List Pages

A single shared component (`configuration-list.svelte`) powers 33+
Kubernetes resource types. Each resource gets custom columns, a
dedicated renderer with problem scoring, and the standard action set.

---

## Resources

### Namespace Section

| Resource       | Key Columns               | Scoring                |
| -------------- | ------------------------- | ---------------------- |
| **Namespaces** | Name, Labels, Status, Age | Non-active phase: +120 |

Namespaces page includes a **Namespace lifecycle** panel for:

- Create namespace (with JSON labels/annotations)
- Update metadata / Force finalize stuck namespaces
- Bootstrap baseline guardrails (ResourceQuota, LimitRange, default-deny)

### Configuration Section

| Resource                | Key Columns                                              | Scoring                                    |
| ----------------------- | -------------------------------------------------------- | ------------------------------------------ |
| **ConfigMaps**          | Name, Namespace, Keys, Age                               | Empty (0 keys): +80                        |
| **Secrets**             | Name, Namespace, Keys, Labels, Type, Age                 | Empty (0 keys): +80                        |
| **Resource Quotas**     | Name, Namespace, Hard/Used, Age                          | No hard limits: +120                       |
| **Limit Ranges**        | Name, Namespace, Limits count, Age                       | No limits: +140                            |
| **HPAs**                | Name, Namespace, Status, Metrics, Min/Max, Replicas, Age | Replica mismatch: up to +280; at max: +100 |
| **PDBs**                | Name, Namespace, MinAvail, MaxUnavail, Healthy, Age      | Unhealthy: +260; no disruptions: +120      |
| **Priority Classes**    | Name, Value, GlobalDefault, Age                          | -                                          |
| **Runtime Classes**     | Name, Handler, Age                                       | -                                          |
| **Leases**              | Name, Namespace, Holder, Duration, Age                   | No holder: +80                             |
| **Mutating Webhooks**   | Name, Webhooks count, Age                                | Empty: +160                                |
| **Validating Webhooks** | Name, Webhooks count, Age                                | Empty: +160                                |

---

## Action Menu

All configuration resources share a unified actions menu with sections:

| Section         | Actions                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **(top)**       | Show details                                                                                                           |
| **Manifest**    | Edit YAML, Copy kubectl get -o yaml, Copy kubectl describe, Run debug describe, Download YAML (opt), Investigate (opt) |
| **Diagnostics** | Port-forward preview (Services only)                                                                                   |
| **Dangerous**   | Delete                                                                                                                 |

Actions are consistent across the three contexts: row ⋮ menu, details sheet, and bulk selection bar.

---

## Table Features

| Feature                     | Available                        |
| --------------------------- | -------------------------------- |
| Sorting (all columns)       | Yes                              |
| Search / filter             | Yes                              |
| Column visibility toggle    | Yes                              |
| CSV export                  | Yes                              |
| Selection checkboxes        | Yes                              |
| Virtual scrolling           | Yes                              |
| Namespace grouping          | Yes (namespace-scoped resources) |
| Watcher controls            | Yes                              |
| Background sync (streaming) | Yes                              |
| Multi-pane workbench (YAML) | Yes                              |
| Quick filters               | Yes (resource-type specific)     |

---

## Problem Scoring

Each resource type has a dedicated renderer that computes a `scoreDelta`
for problem prioritization. Resources with higher scores appear first
when sorted by problem score. Scoring highlights:

- **PDBs**: unhealthy pods (+260), no disruptions allowed (+120)
- **HPAs**: desired > current replicas (up to +280), at max replicas (+100)
- **LimitRanges**: no limit rules (+140)
- **ResourceQuotas**: no hard limits (+120)
- **Webhooks**: no webhooks configured (+160)
- **ConfigMaps/Secrets**: empty data (+80)
- **Leases**: no holder identity (+80)
- **RBAC**: wildcard rules, cluster-admin bindings, risky subjects (variable)

### RBAC Risk Findings

Risk findings in details sheets show severity-colored indicators per finding:

- **Critical** (red dot): wildcard access, impersonation, cluster-admin binding, unauthenticated group
- **High** (amber dot): secret read access, pods/exec or pods/attach
- **Medium** (yellow dot): no subjects configured

Table badges show severity word + score with tooltip listing all findings.

### Secrets Data Display

Three-state visibility cycle per key: Masked (asterisks) -> Base64 -> Decoded (plaintext green). Global toggle cycles all keys. Copy button copies currently visible format.

### ConfigMap/Secret Traffic Chain

Shows which pods mount or reference this ConfigMap/Secret via volumes and envFrom.

---

## For Developers

### Architecture

```
$widgets/datalists/ui/
  configuration-list.svelte               - Main component (6200+ lines)
  configuration-list/
    configuration-actions-menu.svelte     - Row action dropdown
    configuration-bulk-actions.svelte     - Bulk selection toolbar
    configuration-selection-checkbox.svelte - Row selection
    model/
      resource-renderers.ts              - Per-resource detail text + scoring
      resource-renderers.test.ts         - 14 tests
      quick-filters.ts                   - Resource-type-specific filters
      quick-filters.test.ts              - 7 tests
      rows-query.ts                      - Row computation and filtering
      rows-query.test.ts                 - 1 test
```

### Adding a New Configuration Resource

1. Add `workloadKey` mapping in `workload-route-registry.ts`
2. Add column visibility flags in `configuration-list.svelte` (~line 608)
3. Add renderer in `resource-renderers.ts` (`rendererByWorkload`)
4. Add quick filter if needed in `quick-filters.ts`
5. Add kubectl command in `$shared/config/kubectl-commands.ts`
6. Run tests: `pnpm vitest run src/lib/widgets/datalists/ui/configuration-list/`
