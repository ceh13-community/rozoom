# Killer Features - Analysis Modules

Advanced analysis modules that power cross-resource insights,
security scoring, and incident investigation. Each module is a
pure function (input → result) with full test coverage.

---

## Implemented Modules

### Workloads

| Module                | Description                                                                                                                                                          | Tests |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **Pod Timeline**      | Lifecycle timeline: created → scheduled → running/failed. Marks restarts, OOM kills, CrashLoopBackOff, eviction, deletion. Health summary: healthy/degraded/failing. | 6     |
| **Resource Diff**     | Line-by-line YAML comparison with additions/deletions/modifications count.                                                                                           | 4     |
| **HPA Effectiveness** | Evaluates whether HPAs help: scaling conditions, replica mismatch, hitting limits, missing metrics. Grades: effective/underperforming/misconfigured/idle.            | 5     |

### Configuration & Security

| Module                                | Description                                                                                                                                                                     | Tests |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **ConfigMap/Secret Dependency Graph** | Scans pod specs for configmap/secret references (volumes, envFrom, env valueFrom, projected, imagePullSecrets). Answers "what breaks if I change this?"                         | 8     |
| **Secret Rotation Audit**             | Categories: fresh (<30d), aging (30-90d), stale (90-365d), critical (>365d). Rotation score 0-100. Filters system secrets.                                                      | 6     |
| **Security Posture Score**            | Single 0-100 grade (A-F) from 6 weighted signals: cluster score (25%), health score (20%), RBAC risk (20%), secret rotation (15%), network isolation (10%), pod security (10%). | 7     |

### Access Control

| Module                    | Description                                                                                                                                           | Tests |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **RBAC "Who Can" Matrix** | Aggregates roles + bindings into subject-centric view. Per-subject permissions, risk score, flags (wildcard, cluster-admin, secret access, pod exec). | 5     |

### Network

| Module                     | Description                                                                                                              | Tests |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----- |
| **NetworkPolicy Analyzer** | Per-namespace isolation: full/ingress-only/egress-only/none. Detects default-deny policies. Coverage %, isolation score. | 6     |

### Storage

| Module                      | Description                                                                                                  | Tests |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ | ----- |
| **Orphan Storage Detector** | Unbound PVs, PVCs not mounted by pods, snapshots with missing source PVCs. Reclaimable capacity calculation. | 5     |

### Observability

| Module                | Description                                                                                                                      | Tests |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **Alert Correlation** | Groups related alerts by namespace + 5min time window. Common labels, group severity, incident score (% correlated vs isolated). | 5     |
| **Incident Timeline** | Unified chronological view: pod restarts + alerts + events + deploys + node pressures. Peak minute detection.                    | 4     |

---

### Workloads (continued)

| Module                       | Description                                                                                                                    | Tests |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----- |
| **Smart Restart Prediction** | Predicts next crash from restart interval patterns. Confidence levels (high/medium/low), risk labels (Imminent/Soon/Moderate). | 3     |
| **Namespace Health**         | Per-namespace pod health %: running/failed/pending counts, grade (healthy/degraded/critical), overall health.                  | 3     |

### Access Control (continued)

| Module        | Description                                                                                     | Tests |
| ------------- | ----------------------------------------------------------------------------------------------- | ----- |
| **RBAC Diff** | Compare two roles/clusterroles rule-by-rule. Detects added/removed/modified verbs per resource. | 3     |

### Custom Resources (continued)

| Module               | Description                                                                                                        | Tests |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | ----- |
| **Operator Catalog** | Detects installed operators from CRD owner labels and deployment names. Health status, version, managed CRD count. | 3     |

### Storage (continued)

| Module                       | Description                                                                                                  | Tests |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ | ----- |
| **Storage Class Comparison** | Side-by-side parameter diff for storage classes (provisioner, reclaim, binding mode, expansion, parameters). | 2     |

### Cluster Ops (continued)

| Module              | Description                                                                                                                         | Tests |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **Upgrade Planner** | Combines deprecation scan + version audit. Identifies blockers (removed APIs) vs warnings (outdated charts). Readiness score 0-100. | 3     |

### Security & Compliance (continued)

| Module                 | Description                                                                                                   | Tests |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | ----- |
| **Compliance Trend**   | Aggregates scan history into trend points. Detects improving/degrading/stable trajectory. Pass rate delta.    | 3     |
| **CVE-to-Pod Mapping** | Maps vulnerability CVEs to running pods by matching container images. Affected pod count, critical CVE count. | 3     |

---

### Workloads (batch)

| Module                  | Description                                                                                                      | Tests |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- | ----- |
| **Batch Operations**    | Plan + track batch kubectl ops (scale/restart/delete/label) with progress. Args builder for each operation kind. | 4     |
| **Namespace Cost View** | CPU/Memory requests → estimated monthly cost per namespace. Configurable pricing ($30/core, $4/GiB defaults).    | 3     |
| **Namespace Migration** | Export-transform-apply plan between namespaces. Warns about secrets/configmaps with ns-specific refs.            | 2     |

### Access Control (batch)

| Module                       | Description                                                                                                 | Tests |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- | ----- |
| **Least Privilege Analyzer** | Compares granted RBAC verbs vs actual usage. Finds unused verbs per resource, reduction %, recommendations. | 2     |

### Custom Resources (batch)

| Module                  | Description                                                                                              | Tests |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | ----- |
| **CRD Instance Health** | Evaluates CRD instances by status conditions (Ready/Available/Established). Health percent per CRD kind. | 3     |

### Network (batch)

| Module                       | Description                                                                                | Tests |
| ---------------------------- | ------------------------------------------------------------------------------------------ | ----- |
| **Service Connectivity Map** | Service → EndpointSlice → Pod topology graph. Nodes with health status, edges with labels. | 2     |
| **Ingress Health Check**     | Evaluates TLS config, backend availability, load balancer status. Score 0-100 per ingress. | 2     |

### Storage (batch)

| Module              | Description                                                                                            | Tests |
| ------------------- | ------------------------------------------------------------------------------------------------------ | ----- |
| **PVC Usage Gauge** | Provisioned capacity vs actual usage from kubelet metrics. Critical (>90%), warning (>75%) thresholds. | 3     |

### Cluster Ops (batch)

| Module                | Description                                                                         | Tests |
| --------------------- | ----------------------------------------------------------------------------------- | ----- |
| **Helm Release Diff** | Compare installed values vs chart defaults. Finds customized keys, customization %. | 3     |

---

## New Modules (v0.17.0)

### Capacity Intelligence

| Module                  | Description                                                                                                                                              | Tests | Docs                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------- |
| **Resource Heatmap**    | Compare requested vs actual CPU/RAM per workload. Efficiency grades: optimal/over-provisioned/under-provisioned/idle/no-requests. Pod-level aggregation. | 18    | -                      |
| **Node Capacity**       | Allocatable/reserved/used/headroom per node. Cluster-wide totals and utilization percentages.                                                            | 3     | -                      |
| **Bin-Packing Score**   | Packing efficiency per node (tight/balanced/sparse/empty). Cluster-wide fragmentation percentage.                                                        | 4     | K8s scheduling docs    |
| **Autoscaling Posture** | Unified HPA + VPA + KEDA + Cluster Autoscaler/Karpenter model. Coverage tracking per workload.                                                           | 6     | -                      |
| **Cost Efficiency**     | Monthly cost estimation with wasted resource tracking. Configurable pricing ($30/core, $4/GiB). Sorted by savings opportunity.                           | 7     | OpenCost pricing model |

### Performance Observability

| Module                      | Description                                                                                                                                                   | Tests | Docs                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------- |
| **RED Metrics**             | Rate/Errors/Duration per service. PromQL templates for `apiserver_request_total` and `apiserver_request_duration_seconds`. Grades: healthy/degraded/critical. | 8     | [K8s Metrics](https://kubernetes.io/docs/reference/instrumentation/metrics/)                              |
| **CPU Throttling Detector** | Detect `container_cpu_cfs_throttled_periods_total`. Thresholds: >5% warning, >25% critical. Auto-generates limit increase recommendations.                    | 8     | [K8s Resource Management](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/) |
| **SLO Tracking**            | Error budget calculation with multi-window burn rate alerting (14.4x/1h page, 6x/6h page, 1x/3d ticket). Supports availability/latency/throughput SLI types.  | 8     | [Google SRE Workbook](https://sre.google/workbook/alerting-on-slos/)                                      |

### Advanced Security

| Module                | Description                                                                                                                                                        | Tests | Docs                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ---------------------------------------------------------------------------------------------- |
| **RBAC Risk Scanner** | 13 risk patterns from K8s RBAC best practices. CRITICAL: wildcards, escalate, bind, impersonate, nodes/proxy. HIGH: secrets, exec, PV, tokens, webhooks.           | 9     | [RBAC Best Practices](https://kubernetes.io/docs/concepts/security/rbac-good-practices/)       |
| **PSS Compliance**    | Pod Security Standards checker. Baseline: hostNetwork, privileged, hostPath, capabilities. Restricted: runAsNonRoot, drop ALL, seccomp. Per-pod maxCompliantLevel. | 11    | [Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) |

---

## UI Panels (v0.17)

Cluster Ops pages that expose analysis modules in the sidebar navigation:

| Page                      | Sidebar Location   | Source                               |
| ------------------------- | ------------------ | ------------------------------------ |
| **Capacity Intelligence** | Cluster Ops        | `capacity-intelligence-panel.svelte` |
| **Performance**           | Cluster Ops        | `performance-panel.svelte`           |
| **Security Audit**        | Cluster Ops        | `security-audit-panel.svelte`        |
| **GitOps Bootstrap**      | Cluster Ops        | `gitops-bootstrap-panel.svelte`      |
| **Fix Suggestion**        | Reusable component | `fix-suggestion.svelte`              |

Each panel imports the corresponding model module and renders results.
Data is populated from cluster diagnostics or Prometheus metrics.

---

## For Developers

### Using a Module

All modules are exported from `$features/workloads-management`:

```typescript
import {
  buildPodTimeline,
  buildConfigDependencyGraph,
  computeSecurityPosture,
  buildRbacMatrix,
  analyzeNetworkPolicies,
  detectOrphanResources,
  auditSecretRotation,
  correlateAlerts,
  buildIncidentTimeline,
  computeResourceDiff,
  evaluateHpaEffectiveness,
} from "$features/workloads-management";
```

### Module Contract

Each module follows the same pattern:

- **Pure function**: `(input) → result` - no side effects, no API calls
- **Generic input**: accepts `Record<string, unknown>` (raw K8s JSON)
- **Typed output**: strongly typed result with scores, categories, items
- **Tested**: each module has its own `.test.ts` file

### Adding a New Module

1. Create `$features/workloads-management/model/{name}.ts`
2. Export a pure function with typed input/output
3. Create `{name}.test.ts` with edge cases
4. Export from `$features/workloads-management/index.ts`
5. Run: `pnpm vitest run src/lib/features/workloads-management/model/`

### Architecture

```
$features/workloads-management/model/
  pod-timeline.ts                    - Pod lifecycle events (244 lines)
  resource-diff.ts                   - YAML diff engine (57 lines)
  config-dependency-graph.ts         - ConfigMap/Secret consumers (191 lines)
  secret-rotation-audit.ts           - Secret age analysis (135 lines)
  hpa-effectiveness.ts               - HPA scoring (133 lines)
  rbac-matrix.ts                     - Subject × permissions (192 lines)
  network-policy-analyzer.ts         - Namespace isolation (144 lines)
  storage-orphan-detector.ts         - Orphan PV/PVC/snapshot (174 lines)
  security-posture-score.ts          - Weighted security grade (174 lines)
  alert-correlation.ts               - Alert grouping (123 lines)
  incident-timeline.ts               - Unified event timeline (168 lines)
  rbac-diff.ts                       - Role comparison (64 lines)
  storage-class-comparison.ts        - SC parameter diff (48 lines)
  compliance-trend.ts                - Scan history trend (30 lines)
  namespace-health.ts                - Per-NS pod health (62 lines)
  restart-prediction.ts              - Crash prediction (60 lines)
  cve-pod-mapping.ts                 - CVE → pod matching (72 lines)
  operator-catalog.ts                - Operator detection (85 lines)
  upgrade-planner.ts                 - Upgrade readiness (52 lines)
```

Total: 54 model modules, 53 test files.
