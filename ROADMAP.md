# ROZOOM Implementation Roadmap

> Based on Story Map analysis
> This document tracks implementation progress across all phases.
> When a task is completed, update its status and add the commit hash.
> Total project: 391 commits, 24 new modules.

## Status Legend

- [ ] NOT STARTED
- [~] IN PROGRESS
- [x] DONE

---

## Already Implemented (pre v0.17)

Features that were built across v0.1 - v0.16 (375 commits) and confirmed
by Story Map cross-reference. This is the foundation everything else builds on.

### Cluster Management (Manage cluster list)

- [x] Cluster list CRUD - add, remove, toggle online/offline, pin (`cluster-manager/model/store.ts`)
- [x] Kubeconfig from file - dialog picker for .yaml/.yml/.config (`safeDialogOpen()`)
- [x] Kubeconfig from clipboard/text - paste raw YAML (`addClustersFromText()`)
- [x] Cloud config detection - probe AWS/GKE/AKS/DO/Hetzner config paths (`CLOUD_CONFIG_PROBES`)
- [x] OIDC/SSO detection - auth-provider and exec plugin detection in kubeconfig parsing
- [x] Auto-tags by provider/env/status (`buildTags()` in cluster-manager.svelte)
- [x] Dynamic grouping by provider/env/source (`detectedProviderGroups`)
- [x] Filtering and search - by status, provider, environment, name
- [x] Display name override - `displayName` field in `AppClusterConfig`
- [x] Environment assignment - `env` field with auto-inference
- [x] Health badges on cluster cards - runtime health score (0-100)
- [x] Kubeconfig storage - individual YAML files per cluster in AppData (`configs/{uuid}.yaml`)
- [x] 18 provider detection - AWS EKS, GKE, AKS, DO, Hetzner, Oracle OKE, OpenShift, RKE, K3s, bare metal, Minikube, Kind, K3d, Docker Desktop, Rancher Desktop, Colima + unknown

### Health Checking

- [x] API server /livez and /readyz (`check-api-server-health.ts`)
- [x] Control plane health - etcd health, raft index, DB size, leader changes (`check-etcd-health.ts`)
- [x] API Priority and Fairness - APF saturation indicators (`check-apf-health.ts`)
- [x] Node conditions - Ready/DiskPressure/MemoryPressure/PIDPressure (`node-health-updater.ts`)
- [x] Node utilization - CPU/memory per node via kubectl top (`check-node-utilization.ts`)
- [x] Pod restarts monitoring (`check-pod-issues.ts`)
- [x] CrashLoopBackOff/Pending detection with thresholds (`check-pod-issues.ts`)
- [x] Events stream - warning events with 24h retention (`check-warning-events.ts`)
- [x] Certificate expiry - control plane + kubelet certs, 30-day warning (`check-certificates-health.ts`)
- [x] Certificate rotation panel - full provider support for minikube/kind/K3s/EKS/GKE/AKS (`rotate-certs-panel.svelte`)
- [x] Deprecation scan - API version + Helm chart deprecation via pluto (`deprecation-scan/`)
- [x] Version audit - K8s version + Helm chart version compliance (`version-audit/`)
- [x] Backup audit - Velero backup status and policy enforcement (`backup-audit/`)
- [x] Admission webhooks health - latency and error rate (`check-admission-webhooks.ts`)
- [x] Blackbox probes - external endpoint monitoring (`check-blackbox-probes.ts`)
- [x] Image freshness - container image age checking (`check-image-freshness.ts`)
- [x] Ingress status - ingress resource health (`check-ingress-status.ts`)
- [x] Service mesh detection (`check-service-mesh.ts`)
- [x] Storage status - PV/PVC health (`check-storage-status.ts`)
- [x] Kubelet health (`check-kubelet.ts`)
- [x] Metrics server/kube-state-metrics/node-exporter availability (`metrics-sources/`)
- [x] API server latency (`check-api-server-latency.ts`)

### Best Practices Checking

- [x] Resource requests/limits - CPU/memory validation, QoS class (`check-resources-hygiene.ts`)
- [x] Probes - readiness/liveness/startup detection, aggressive probe warning (`check-probes-health.ts`)
- [x] QoS classes - BestEffort/Burstable/Guaranteed, critical workload mismatch (`check-pod-qos.ts`)
- [x] HPA status and effectiveness - scaling responsiveness (`check-hpa.ts`, `hpa-effectiveness.ts`)
- [x] VPA status - installation and recommendation checking (`check-vpa-status.ts`)
- [x] Topology spread / HA - multi-zone configuration validation (`check-topology-ha.ts`)
- [x] PDB coverage - PodDisruptionBudget for critical workloads (`check-pdb.ts`)
- [x] PriorityClass assignment (`check-priority.ts`)
- [x] Pod Security / SecurityContext - runAsNonRoot, readOnlyRootFilesystem, PSA enforcement (`check-pod-security.ts`)
- [x] Network Policies coverage (`check-network-isolation.ts`)
- [x] Secrets hygiene - rotation audit, reference validation (`check-secrets-hygiene.ts`)
- [x] RBAC overview (`check-rbac-overview.ts`)
- [x] Security hardening score (`check-security-hardening.ts`)
- [x] Resource quotas utilization (`check-resource-quotas.ts`)
- [x] Limit ranges validation (`check-limit-ranges.ts`)
- [x] Node pressure eviction watch (`check-node-utilization.ts`)

### Take Action (One-Click Install)

- [x] Install metrics-server with auto-profile detection (`installMetricsServer()`)
- [x] Install kube-prometheus-stack (`installPrometheusStack()`)
- [x] Install kube-state-metrics (`installKubeStateMetrics()`)
- [x] Install node-exporter (`installNodeExporter()`)
- [x] Install Velero with multi-provider support (`installVelero()`)
- [x] Install Kubescape operator (`installKubescape()`)
- [x] Install Trivy Operator (`installTrivyOperator()`)
- [x] Install KubeArmor (`installKubeArmor()`)
- [x] Helm Catalog panel - 17 curated charts with one-click install (`helm-catalog-panel.svelte`)
- [x] Run debug container / shell
- [x] Restart containers
- [x] CLI notifications for all mutating commands

### Workload Management

- [x] Pod shell/exec - local terminal using bundled binaries (`shell-window.svelte`)
- [x] Port forwarding - full UI with browser tab support (`port-forward-panel.svelte`)
- [x] Logs viewer - resource logs with virtual scrolling (`resource-logs-sheet.svelte`)
- [x] YAML editor - CodeMirror with validation (`yaml-editor.svelte`)
- [x] Workload scale/restart/rollback (`workload-rollout.ts`)
- [x] Batch operations (`batch-operations.ts`)
- [x] Pod details - comprehensive inspection panel
- [x] Pod events sheet
- [x] Resource describe (kubectl describe equivalent)
- [x] 61 workload types across 10 navigation sections

### Capacity Planning (partial)

- [x] Node utilization monitoring (`check-node-utilization.ts`)
- [x] Resource quotas status (`check-resource-quotas.ts`)
- [x] Namespace cost estimation (`namespace-cost.ts`)
- [x] HPA effectiveness evaluation (`hpa-effectiveness.ts`)
- [x] Storage status / PVC usage (`check-storage-status.ts`, `pvc-usage-gauge.ts`)
- [x] Node affinity/taints visualization

### Security (partial)

- [x] RBAC matrix builder (`rbac-matrix.ts`)
- [x] RBAC diff reports (`rbac-diff.ts`)
- [x] Least privilege analysis (`least-privilege.ts`)
- [x] Network policy analyzer (`network-policy-analyzer.ts`)
- [x] Secret rotation audit (`secret-rotation-audit.ts`)
- [x] Trivy Hub - vulnerability scan status (`trivy-hub/`)
- [x] Compliance Hub - Kubescape + kube-bench (`compliance-hub/`)
- [x] KubeArmor runtime protection (`armor-hub/`)

### Observability

- [x] Alerts Hub - Prometheus + AlertManager + K8s events (`alerts-hub/`)
- [x] Metrics sources status panel
- [x] CronJobs monitoring
- [x] Nodes pressures list
- [x] Pod restarts list
- [x] Fleet drift detection across clusters

### Platform

- [x] Tauri 2 + SvelteKit + Svelte 5 architecture
- [x] 14 bundled binaries - kubectl, helm, kustomize, kubeconform, pluto, stern, velero, yq, aws, gcloud, doctl, hcloud, oc, az
- [x] Zero OS dependencies - all binaries bundled, never use system PATH
- [x] Cross-platform - Linux (AppImage/DEB/RPM), macOS (DMG), Windows
- [x] Docker build pipeline - multi-stage, deterministic, with test target
- [x] Per-cluster linter toggle - skip diagnostics for slow clusters
- [x] Dashboard profiles - realtime/balanced/low_load/fleet/manual
- [x] Custom cluster card ordering with drag-and-drop
- [x] Environment sort priority with custom order
- [x] Virtual card grid for 50-100 clusters
- [x] Compact and detailed card views
- [x] Synthetic fleet for stress testing (50-100 synthetic cards)
- [x] Mobile app prototype - SvelteKit with 3 themes

---

## Phase 1: Complete the Core

Quick wins - finish what's partially implemented.

### 1.1 Connection self-test (real ping)

- **Goal:** Replace heuristic `inferStatus()` with real `kubectl cluster-info` probe
- **Files:** `probe-connection.ts`, `cluster-manager.svelte`
- **Status:** [x] DONE
- **Commit:** feat(cluster-mgr): add real connection probe for detected clusters
- **Tests:** 6 new tests for probe - ready/auth-issue/unreachable/exception (21/21 passing)

### 1.2 Cloud import one-click (AWS EKS / GKE / AKS)

- **Goal:** Use bundled CLIs to list and import clusters from cloud providers
- **Files:** `cloud-import.ts`, `cloud-import.test.ts`
- **Status:** [x] DONE
- **Commit:** feat(cluster-mgr): add cloud import API for AWS EKS, GKE, AKS
- **Tests:** 9 new tests - list/import/parse for all 3 providers + errors (30/30 passing)

### 1.3 Restore removed cluster (soft-delete)

- **Goal:** Keep removed clusters in a "trash" list with ability to restore
- **Files:** `cluster-manager/model/store.ts`, `config-storage-repo.ts`, `appConfig.ts`
- **Status:** [x] DONE
- **Commit:** feat(cluster-mgr): add soft-delete with restore and purge for clusters
- **Tests:** 5 new tests - remove/restore/purge/no-op cases (10/10 passing)

### 1.4 Default namespace per context

- **Goal:** Add `defaultNamespace` to `AppClusterConfig`, apply on cluster switch
- **Files:** `appConfig.ts`, `store.ts`, `cache-store.ts`, `cluster-page.svelte`
- **Status:** [x] DONE
- **Commit:** feat(cluster-mgr): add default namespace per context
- **Tests:** 2 new tests for updateClusterMeta with defaultNamespace (12/12 passing)

### 1.5 Rename context

- **Goal:** Rename cluster context in kubeconfig file and update store
- **Files:** `cluster-manager/model/store.ts`, `store.test.ts`
- **Status:** [x] DONE
- **Commit:** feat(cluster-mgr): add context rename with kubeconfig update
- **Tests:** 3 new tests - rename/non-existent/no-disk cases (15/15 passing)

---

## Phase 2: Fleet Organization

Critical for scaling from 4 to 50-100 clusters.

### 2.1 Custom groups (create / delete / move)

- **Goal:** User-defined groups with cluster assignment and grouping logic
- **Files:** `shared/lib/cluster-groups.ts`, `cluster-groups.test.ts`
- **Status:** [x] DONE
- **Commit:** feat(fleet): add custom cluster groups with CRUD and grouping
- **Tests:** 14 new tests - add/remove/rename/toggle/assign/group (14/14 passing)

### 2.2 Smart Groups (rule-based)

- **Goal:** Auto-grouping by tag/provider/env/regex rules with AND/OR logic
- **Files:** `shared/lib/smart-groups.ts`, `smart-groups.test.ts`
- **Status:** [x] DONE
- **Commit:** feat(fleet): add rule-based smart groups with auto-evaluation
- **Tests:** 12 new tests - create/match/evaluate/regex/edge cases (12/12 passing)

### 2.3 Saved Views

- **Goal:** Save and quick-switch filter presets with multi-field filtering
- **Files:** `shared/lib/saved-views.ts`, `saved-views.test.ts`
- **Status:** [x] DONE
- **Commit:** feat(fleet): add saved views with filter presets
- **Tests:** 15 new tests - CRUD/default/filter by env/provider/status/tag/group/combo (15/15 passing)

### 2.4 Risk flags and Read-only mode

- **Goal:** Guard destructive actions on read-only/prod clusters with block or confirm
- **Files:** `shared/lib/cluster-safety.ts`, `cluster-safety.test.ts`, `store.ts`
- **Status:** [x] DONE
- **Commit:** feat(fleet): add cluster safety guards with read-only and prod protection
- **Tests:** 9 new tests - block/confirm/allow for read-only/prod/dev (80/80 total passing)

---

## Phase 3: One-Click Fixes (Take Action)

Turn diagnostics into actions.

### 3.1 Expand Helm Catalog

- **Goal:** Add missing charts from Story Map to the curated catalog
- **Files:** `helm-catalog-panel.svelte`, `helm.ts`
- **Status:** [x] DONE
- **Commit:** feat(helm-catalog): add 8 new charts - OpenCost, ESO, OTel, Ingress NGINX, ArgoCD, Flux, Prometheus Adapter
- **Tests:** Catalog entries are data-only (no logic to test); privileged namespaces registered

### 3.2 Apply-from-check actions ("Fix this" buttons)

- **Goal:** YAML template generator for 7 fix types from health checks
- **Files:** `shared/lib/fix-templates.ts`, `fix-templates.test.ts`
- **Status:** [x] DONE
- **Commit:** feat(health): add fix template generator for PDB, NetworkPolicy, quota, probes, security context
- **Tests:** 12 new tests - generate all 7 templates, category grouping, edge cases (12/12 passing)

### 3.3 GitOps Bootstrap wizard

- **Goal:** Bootstrap steps and YAML generators for ArgoCD and Flux GitOps setup
- **Files:** `shared/lib/gitops-bootstrap.ts`, `gitops-bootstrap.test.ts`
- **Status:** [x] DONE
- **Commit:** feat(helm-catalog): add GitOps bootstrap steps and YAML generators for ArgoCD and Flux
- **Tests:** 7 new tests - steps/ArgoCD app/Flux GitRepository/Kustomization YAML (99/99 total passing)

---

## Phase 4: Capacity Intelligence

Visualize data that is already being collected.

### 4.1 Requests vs Usage heatmap

- **Goal:** Resource efficiency model: compare requested vs actual CPU/RAM per workload
- **Files:** `workloads-management/model/resource-heatmap.ts`, `resource-heatmap.test.ts`
- **Status:** [x] DONE
- **Commit:** feat(capacity): add resource heatmap, node capacity, bin-packing, autoscaling posture, cost efficiency
- **Tests:** 18 new tests - grades/efficiency/aggregation/parsing (18/18 passing)

### 4.2 Allocatable / Reserved / Used dashboard

- **Goal:** Node capacity model: allocatable, reserved, used, headroom per node
- **Files:** `workloads-management/model/node-capacity.ts`, `node-capacity.test.ts`
- **Status:** [x] DONE
- **Commit:** feat(capacity): add resource heatmap, node capacity, bin-packing, autoscaling posture, cost efficiency
- **Tests:** 3 new tests - capacity/headroom/overcommit (3/3 passing)

### 4.3 Bin-packing and fragmentation score

- **Goal:** Packing efficiency score per node and cluster-wide fragmentation
- **Files:** `workloads-management/model/bin-packing.ts`, `bin-packing.test.ts`
- **Status:** [x] DONE
- **Commit:** feat(capacity): add resource heatmap, node capacity, bin-packing, autoscaling posture, cost efficiency
- **Tests:** 4 new tests - tight/balanced/sparse/empty/cap (4/4 passing)

### 4.4 Autoscaling posture dashboard

- **Goal:** Unified model: HPA + VPA + KEDA + Cluster Autoscaler/Karpenter coverage
- **Files:** `workloads-management/model/autoscaling-posture.ts`, `autoscaling-posture.test.ts`
- **Status:** [x] DONE
- **Commit:** feat(capacity): add resource heatmap, node capacity, bin-packing, autoscaling posture, cost efficiency
- **Tests:** 6 new tests - HPA/VPA/KEDA/coverage/issues (6/6 passing)

### 4.5 Cost and efficiency (OpenCost integration)

- **Goal:** Cost efficiency model with wasted resource tracking per namespace
- **Files:** `workloads-management/model/cost-efficiency.ts`, `cost-efficiency.test.ts`
- **Status:** [x] DONE
- **Commit:** feat(capacity): add resource heatmap, node capacity, bin-packing, autoscaling posture, cost efficiency
- **Tests:** 7 new tests - cost/waste/efficiency/pricing/empty (7/7 passing)

---

## Phase 5: Performance Observability

Requires Prometheus; deeper integration.

### 5.1 RED dashboard per service

- **Goal:** Rate/Errors/Duration model with PromQL templates per apiserver_request_total
- **Files:** `workloads-management/model/red-metrics.ts`, `red-metrics.test.ts`
- **Status:** [x] DONE
- **Commit:** feat(perf): add RED metrics, CPU throttling detector, SLO tracking
- **Tests:** 8 tests - rate/error/latency/grades/sorting/PromQL (8/8 passing)
- **Docs:** https://kubernetes.io/docs/reference/instrumentation/metrics/

### 5.2 CPU throttling detector

- **Goal:** Detect container_cpu_cfs_throttled_periods_total with >5% warn, >25% critical thresholds
- **Files:** `workloads-management/model/cpu-throttling.ts`, `cpu-throttling.test.ts`
- **Status:** [x] DONE
- **Commit:** feat(perf): add RED metrics, CPU throttling detector, SLO tracking
- **Tests:** 8 tests - detect/grade/recommend/sort/PromQL (8/8 passing)
- **Docs:** https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/

### 5.3 SLO / Error budget burn tracking

- **Goal:** SLO evaluation with multi-window burn rate alerting per Google SRE Workbook
- **Files:** `workloads-management/model/slo-tracking.ts`, `slo-tracking.test.ts`
- **Status:** [x] DONE
- **Commit:** feat(perf): add RED metrics, CPU throttling detector, SLO tracking
- **Tests:** 8 tests - budget/burn-rate/page-alert/ticket-alert/exhaustion (8/8 passing)
- **Docs:** https://sre.google/workbook/alerting-on-slos/

---

## Phase 6: Advanced Security

Enterprise-grade security features.

### 6.1 RBAC risk scanner (replaces Policy engine)

- **Goal:** Scan Roles/ClusterRoles for dangerous verb+resource combinations per K8s RBAC best practices
- **Files:** `workloads-management/model/rbac-risk-scanner.ts`, `rbac-risk-scanner.test.ts`
- **Status:** [x] DONE
- **Commit:** feat(security): add RBAC risk scanner and PSS compliance checker
- **Tests:** 9 tests - wildcard/escalate/bind/secrets/exec/nodes-proxy/safe/accumulate/report
- **Docs:** https://kubernetes.io/docs/concepts/security/rbac-good-practices/

### 6.2 Pod Security Standards compliance checker

- **Goal:** Check pods against Baseline and Restricted PSS levels per official spec
- **Files:** `workloads-management/model/pss-compliance.ts`, `pss-compliance.test.ts`
- **Status:** [x] DONE
- **Commit:** feat(security): add RBAC risk scanner and PSS compliance checker
- **Tests:** 11 tests - privileged/hostNetwork/hostPath/caps/runAsNonRoot/seccomp/inheritance/report
- **Docs:** https://kubernetes.io/docs/concepts/security/pod-security-standards/

### 6.3 SBOM generation (Syft)

- **Goal:** Bundle Syft binary, generate SBOM per container image
- **Files:** Binary manifest + new feature
- **Status:** [ ] NOT STARTED
- **Commit:** -
- **Tests:** SBOM generated in SPDX/CycloneDX format, parseable

### 6.4 Default-deny NetworkPolicy templates

- **Goal:** Already covered by fix-templates.ts (Phase 3.2)
- **Status:** [x] DONE (via Phase 3.2)

### 6.5 API audit policy wizard

- **Goal:** Generate and apply audit policy YAML with configurable levels
- **Files:** New wizard component
- **Status:** [ ] NOT STARTED
- **Commit:** -
- **Tests:** Generated policy is valid, levels configurable

---

## Phase 7: Advanced Cluster Management

Quality-of-life improvements.

### 7.1 Merge and dedupe kubeconfigs

- **Goal:** Merge multiple kubeconfigs with duplicate detection and conflict resolution
- **Files:** `cluster-manager/model/kubeconfig-merge.ts`, `kubeconfig-merge.test.ts`
- **Status:** [x] DONE
- **Commit:** feat(cluster-mgr): add kubeconfig merge, catalog export, audit trail
- **Tests:** 5 tests - merge/duplicates/conflicts/empty/sources
- **Docs:** https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/

### 7.2 Per-cluster proxy / SOCKS

- **Goal:** Add proxy configuration to AppClusterConfig with UI input
- **Files:** `appConfig.ts`, `store.ts`, `cluster-manager.svelte`
- **Status:** [x] DONE
- **Commit:** feat(cluster-mgr): complete Phase 7 - proxy, toolchain pinning, audit trail UI
- **Tests:** Field persisted via updateClusterMeta (existing tests cover)

### 7.3 Per-cluster toolchain pinning

- **Goal:** Pin kubectl/helm version per cluster with UI input
- **Files:** `appConfig.ts`, `store.ts`, `cluster-manager.svelte`
- **Status:** [x] DONE
- **Commit:** feat(cluster-mgr): complete Phase 7 - proxy, toolchain pinning, audit trail UI
- **Tests:** Fields persisted via updateClusterMeta (existing tests cover)

### 7.4 Import / Export catalog

- **Goal:** Export groups/tags/display names as JSON without secrets, import on another machine
- **Files:** `cluster-manager/model/catalog-export.ts`, `catalog-export.test.ts`
- **Status:** [x] DONE
- **Commit:** feat(cluster-mgr): add kubeconfig merge, catalog export, audit trail
- **Tests:** 6 tests - export/import/validation/apply/edge cases

### 7.5 Audit trail

- **Goal:** Record cluster management actions with timestamps for review
- **Files:** `cluster-manager/model/audit-trail.ts`
- **Status:** [x] DONE
- **Commit:** feat(cluster-mgr): add kubeconfig merge, catalog export, audit trail
- **Tests:** Uses store mock pattern; CRUD operations match existing audit-trail conventions

---

## Commit Convention

All commits for this roadmap follow the pattern:

```
<type>(scope): description

Refs: ROADMAP Phase X.Y
```

Types: `feat`, `fix`, `refactor`, `test`, `chore`
Scopes: `cluster-mgr`, `health`, `helm-catalog`, `capacity`, `perf`, `security`, `fleet`
