# Global Triage - Cross-Resource Problem Scanner

Scans ~46 Kubernetes resource types across the entire cluster, scores each
resource for problems, and presents a ranked table of findings sorted by
severity.

---

## Page Sections

### Severity Summary

Three badges at the top showing aggregate counts:

| Badge               | Score range | Meaning                                                                                                       |
| ------------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| **Critical** (red)  | 200+        | Resource is broken or about to break - unavailable replicas, NotReady nodes, failing jobs, deleting resources |
| **Warning** (amber) | 80-199      | Resource has issues that may escalate - restarts, empty configs, missing handlers, stale leases               |
| **Low** (blue)      | 1-79        | Minor hygiene issues - suspended cronjobs, zero-value priorities, missing last schedule                       |

### Controls

| Control            | Description                                                            |
| ------------------ | ---------------------------------------------------------------------- |
| **Search**         | Free-text filter across name, namespace, workload type, status, reason |
| **Group by**       | `None` (flat table) / `Severity` / `Workload type` / `Namespace`       |
| **Refresh triage** | Re-scan all resources (sequential with concurrency limit)              |
| **Pagination**     | 100 items per page with Previous/Next navigation                       |

### Results Table

| Column        | Description                                                  |
| ------------- | ------------------------------------------------------------ |
| **Score**     | Numeric problem score with color-coded severity badge        |
| **Name**      | Resource name, clickable link to the workload detail page    |
| **Namespace** | Resource namespace or "cluster" for cluster-scoped resources |
| **Workload**  | Resource type label (Pods, Deployments, Services, etc.)      |
| **Status**    | Human-readable status from the scorer                        |
| **Reason**    | Why the resource was flagged (truncated, full text on hover) |

---

## Scanned Resource Types (46)

### Core Workloads

Pods, Deployments, DaemonSets, StatefulSets, ReplicaSets, ReplicationControllers, Jobs, CronJobs

### Cluster

Namespaces, Nodes, PriorityClasses, RuntimeClasses, Leases

### Configuration

ConfigMaps, Secrets, ResourceQuotas, LimitRanges

### RBAC

ServiceAccounts, Roles, ClusterRoles, RoleBindings, ClusterRoleBindings

### Networking

Services, Endpoints, EndpointSlices, Ingresses, IngressClasses, NetworkPolicies

### Gateway API (optional)

GatewayClasses, Gateways, HTTPRoutes, ReferenceGrants

### Storage

PersistentVolumeClaims, PersistentVolumes, StorageClasses, CSIStorageCapacities

### Volume Snapshots (optional)

VolumeSnapshots, VolumeSnapshotContents, VolumeSnapshotClasses, VolumeAttributesClasses

### Admission

MutatingWebhookConfigurations, ValidatingWebhookConfigurations

### Extensions

CustomResourceDefinitions

Optional resource types (Gateway API, Volume Snapshots) are auto-discovered
via `kubectl api-resources` and skipped if the cluster doesn't support them.

---

## Scoring Examples

| Resource           | Condition                       | Score | Severity |
| ------------------ | ------------------------------- | ----- | -------- |
| Pod                | Pending + 2 restarts + waiting  | 380   | Critical |
| Deployment         | 0/3 available + not progressing | 440   | Critical |
| Node               | NotReady + memory pressure      | 380   | Critical |
| PVC                | Phase: Pending                  | 220   | Critical |
| ClusterRoleBinding | Binds cluster-admin             | 220   | Critical |
| HPA                | Condition failing               | 180   | Warning  |
| Endpoint           | No addresses                    | 180   | Warning  |
| CronJob            | Suspended + no last schedule    | 60    | Low      |
| ConfigMap          | Empty (0 keys)                  | 60    | Low      |

---

## Performance

- **Concurrency limit**: 3 kubectl calls at a time (prevents API server overload)
- **Discovery cache**: API resource list cached for 5 minutes per cluster
- **Refresh token**: stale responses from superseded requests are discarded
- **Pagination**: renders 100 rows per page instead of the full result set

---

## For Developers

### Architecture

```
$widgets/datalists/ui/triage/
  global-triage-panel.svelte        - UI: fetch → score → group → paginate → render
  global-triage-panel.test.ts       - Rendering and coverage tests

$features/workloads-management/model/
  triage-manifest.ts                - Manifest: which resources to scan, scorer mapping
  triage-scorers.ts                 - 46 scorer functions (one per resource type)
  triage-discovery.ts               - API resource discovery + cache
  triage.ts                         - ProblemResource type, sort, classify errors
```

### Adding a New Scorer

1. Add the resource type to `TRIAGE_SCORERS` map in `triage-manifest.ts`
2. Add a scorer ID to `TriageScorerId` union type
3. Implement the scorer function in `triageScorers` record in `triage-scorers.ts`
4. Ensure the resource has a kubectl command in `KUBECTL_COMMANDS`
5. If the resource is optional (CRD-based), set `optionalFeature` appropriately
6. Run tests: `pnpm vitest run triage`

### Scorer Contract

Each scorer receives `(item, context)` and returns `{ problemScore, status, reason }`:

- `problemScore: 0` = healthy, skip from results
- `problemScore: 1-79` = low severity
- `problemScore: 80-199` = warning
- `problemScore: 200+` = critical
- `status`: short human label (e.g. "2/3 available", "Bound", "NotReady")
- `reason`: explanation joined with `·` separator, or null if healthy
