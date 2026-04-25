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

## Phase 8: Enterprise Security Hardening

Gap analysis (April 2026) flagged 10 items that block adoption in regulated
environments: SOC 2 Type II, ISO 27001, PCI-DSS 4.0, HIPAA, FedRAMP, DORA/SOX.
Current posture is solid for SMB / internal dev-team use (strong hygiene
checks, RBAC scanner, PSS compliance, 0600 perm enforcement, CSP-restricted
egress, SHA256-pinned bundled binaries) but lacks at-rest crypto, tamper-proof
audit, signed updates, and credential-scrubbed telemetry.

Items are ordered by compliance impact. 8.1 is the blocker for PCI/HIPAA/SOC 2
and must ship first.

### 8.1 Encrypted kubeconfig storage at rest

- **Goal:** Kubeconfig YAML (with tokens, client-keys, client-certs) is
  encrypted on disk. Plaintext access only in memory, only while a cluster
  is active.
- **Why:** Current state stores `AppData/configs/<uuid>.yaml` as plaintext
  via `writeTextFile()`. Blocks PCI-DSS req 3, ISO 27001 A.10.1, SOC 2 CC6.1,
  FedRAMP SC-28, HIPAA §164.312(a)(2)(iv).
- **Status:** [ ] NOT STARTED

#### Design

**Primary:** `tauri-plugin-stronghold` (IOTA Stronghold). Rationale: single
encrypted snapshot file, purpose-built for secrets, Argon2id-derived key from
user passphrase, no dependency on OS keyring availability (works headless on
CI runners too).

**Fallback path:** OS keyring (`tauri-plugin-keyring`) per kubeconfig entry
when user opts out of Stronghold passphrase. Uses:

- Linux: Secret Service (GNOME Keyring / KWallet) via D-Bus
- macOS: Keychain
- Windows: DPAPI + Credential Manager

Both paths converge on the same API surface:

```ts
// src/lib/features/cluster-manager/api/credential-vault.ts
export interface CredentialVault {
  readonly mode: "stronghold" | "keyring" | "plaintext";
  unlock(passphrase?: string): Promise<void>;
  get(uuid: string): Promise<string | null>;
  put(uuid: string, yaml: string): Promise<void>;
  remove(uuid: string): Promise<void>;
  rotate(newPassphrase: string): Promise<void>;
  lock(): void;
}
```

`plaintext` mode stays supported as a migration bridge and escape hatch for
CI contexts, but the UI warns red when it's active on an enterprise-tagged
install.

#### UX

1. **First-launch onboarding** adds a new step: "Protect your credentials".
   Three options: Stronghold (recommended), OS keyring, Skip (plaintext).
   Each explains the trade-off in one sentence.
2. **Session lock:** after N minutes idle (default 30, configurable) the
   vault locks. Status bar shows a padlock; kubectl calls that need the
   kubeconfig re-prompt for the passphrase (autofocused, Enter submits).
3. **Passphrase rotation** in Settings → Security: asks for current
   passphrase, new passphrase + confirmation, re-encrypts the snapshot.
4. **Recovery code:** at setup we show a one-time BIP-39-style recovery
   phrase that can decrypt the snapshot if the passphrase is lost. User
   confirms by retyping. Stored nowhere; user's responsibility.

#### Migration plan

Runs automatically on first launch after the upgrade:

1. Detect existing `AppData/configs/*.yaml` files.
2. Show a modal: "We're upgrading your credential storage. Choose a
   passphrase / keyring / skip."
3. If Stronghold/keyring chosen:
   - Read each plaintext file.
   - Put into vault via `CredentialVault.put(uuid, yaml)`.
   - On success, overwrite the source file with random bytes (3 passes),
     then delete.
   - Write migration marker to prefs store (`security.vaultVersion = 2`).
4. If Skip chosen: set marker `security.vaultVersion = 1` (unchanged) and
   show a persistent yellow banner in Manage Clusters.
5. Idempotent: rerunnable if interrupted; skips files already migrated.

On downgrade (version `< 2`) the app refuses to start and prints a clear
message: "Your credentials are encrypted. Upgrade to ROZOOM >= 0.18 or
restore the pre-encryption snapshot from ..." (we keep a one-shot
`.pre-vault-backup/` untouched for 14 days).

#### Files

- **New:**
  - `src-tauri/src/vault_cmds.rs` — Rust tauri::command wrappers for
    stronghold/keyring calls
  - `src-tauri/Cargo.toml` — `tauri-plugin-stronghold` + `keyring` crate
  - `src/lib/features/cluster-manager/api/credential-vault.ts` — TS
    interface + stronghold/keyring/plaintext adapters
  - `src/lib/features/cluster-manager/api/credential-vault.test.ts` — unit
    tests for each adapter with mocked Tauri commands
  - `src/lib/features/cluster-manager/model/vault-migration.ts` — migration
    runner with progress events
  - `src/lib/pages/cluster-manager/ui/vault-setup-modal.svelte` — onboarding
    + rotation UI
  - `src/lib/shared/lib/session-lock.svelte.ts` — idle timer, lock event bus
- **Modified:**
  - `src/lib/features/cluster-manager/api/disk.ts` — delegate to
    `CredentialVault` instead of raw `writeTextFile`
  - `src/lib/shared/api/kubectl-proxy.ts` — materialize temp kubeconfig
    from vault on-demand (same pattern as `test-connection.ts` uses today)
  - `src-tauri/tauri.conf.json` — register stronghold plugin
  - `src-tauri/capabilities/default.json` — grant stronghold/keyring
    capabilities
- **Tests:**
  - vault adapter round-trip per backend
  - migration idempotency (rerun after interruption)
  - session lock timer with fake timers
  - kubectl-proxy materialization cleanup on crash (lingering temp files
    are swept on next launch)

#### Risks

- **OS keyring unavailable** on headless Linux (no D-Bus). Detected at
  `unlock()`; UI prompts for Stronghold fallback.
- **kubectl sidecar needs plaintext path.** Mitigation: write temp
  kubeconfig to `AppData/session/<rand>.yaml`, pass `--kubeconfig`, delete
  via tracked-handles cleanup on process exit + app shutdown hook.
- **Lost passphrase → total data loss.** Mitigation: recovery code at
  setup + 14-day `.pre-vault-backup/` snapshot.
- **Stronghold snapshot corruption** (rare but documented). Mitigation:
  rolling backup of last 3 snapshots under `AppData/vault-backups/`.

#### Compliance unlocks

- PCI-DSS 4.0 req 3.5 (stored credential protection)
- ISO 27001 A.10.1.1 (cryptographic controls policy)
- SOC 2 CC6.1 (logical access protection)
- FedRAMP Moderate SC-28 (protection of information at rest)
- HIPAA §164.312(a)(2)(iv) (encryption and decryption)
- NIST 800-53 SC-28, IA-5(1)

#### References

- Tauri Stronghold plugin: https://v2.tauri.app/plugin/stronghold/
- IOTA Stronghold: https://wiki.iota.org/stronghold.rs/overview
- Argon2id RFC 9106: https://datatracker.ietf.org/doc/html/rfc9106
- OWASP Secrets at Rest: https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
- NIST 800-63B session management: https://pages.nist.gov/800-63-3/sp800-63b.html

### 8.2 Sentry credential scrubbing

- **Goal:** `beforeSend` hook strips `token:`, `client-key-data`,
  `client-certificate-data`, `--oidc-client-secret=`, Authorization
  headers, kubeconfig paths, and server URLs from events before upload.
- **Why:** Without scrubbing, a thrown error inside a helm/kubectl helper
  can send a full kubeconfig path + stderr line (containing the token) to
  Sentry. Blocks GDPR Art. 32, SOC 2 CC6.7.
- **Files:** `src/lib/shared/config/sentry.ts` (add `beforeSend`), new
  `src/lib/shared/config/sentry-scrub.ts` with regex set + unit tests.
- **Status:** [ ] NOT STARTED
- **Tests:** token masked, client-key masked, client-cert masked, bearer
  Authorization header masked, kubeconfig absolute path → `[kubeconfig]`,
  server URLs (`https://*.eks.amazonaws.com`) → `[apiserver]`. Fuzz with
  known-bad Sentry payloads.
- **Docs:** https://docs.sentry.io/platforms/javascript/configuration/filtering/

### 8.3 Tamper-proof audit log

- **Goal:** HMAC-chain each audit entry (entry N's HMAC covers entry N-1
  HMAC + N body). Detect deletions and edits. Append-only file mode.
- **Why:** Current `audit-trail.ts` stores events in
  `dashboard-preferences.json` which the user can edit freely. Blocks SOC 2
  CC7.3, ISO 27001 A.12.4.2, FedRAMP AU-9.
- **Files:** `src/lib/features/cluster-manager/model/audit-trail.ts`
  (HMAC chain), new `audit-trail-hmac.ts` + tests, `audit-trail-export.ts`
  (JSONL for SIEM forward).
- **Status:** [ ] NOT STARTED
- **Tests:** edit middle entry → chain verification fails at that index;
  delete entry → verification fails; append → chain extends; export is
  valid JSONL parseable by jq.
- **Docs:** https://en.wikipedia.org/wiki/Hash_chain, NIST SP 800-92.

### 8.4 Enforce read-only mode

- **Goal:** When `AppClusterConfig.readOnly === true`, block every non-GET
  kubectl verb (delete/apply/patch/create/replace/scale/edit/exec) at the
  kubectl-proxy layer and disable mutating UI controls.
- **Why:** Flag exists but is cosmetic today. Blocks ISO 27001 A.9.4.1
  (principle of least privilege).
- **Files:** `src/lib/shared/api/kubectl-proxy.ts` (reject mutating args),
  all action menus (disable in UI with tooltip), new
  `src/lib/features/cluster-manager/model/mutation-guard.ts` (verb
  classifier + tests).
- **Status:** [ ] NOT STARTED
- **Tests:** verb classifier has explicit mutating set; apply/delete/patch
  blocked in proxy; get/list/watch pass; dry-run=client still allowed.

### 8.5 Signed auto-update with rollback

- **Goal:** Tauri updater enabled with Ed25519 signing; last-good version
  pinned; automatic rollback on crash-on-launch.
- **Why:** Manual .deb/.rpm distribution is unsigned. Blocks NIST SSDF
  PS.2, US Executive Order 14028 (SBOM + signed releases).
- **Files:** `src-tauri/tauri.conf.json` (updater block), GitHub Actions
  signing step, update server endpoint, `updater-public.key` in repo.
- **Status:** [ ] NOT STARTED
- **Tests:** e2e: start on v0.18, server returns signed v0.19 → upgrade
  succeeds; server returns unsigned → upgrade rejected; crash-on-launch
  after upgrade → downgrade to v0.18.
- **Docs:** https://v2.tauri.app/plugin/updater/

### 8.6 Cosign/sigstore bundled binaries

- **Goal:** Replace SHA256 checksum verification in `download-binaries.js`
  with cosign verify against sigstore public-good instance (where
  upstream signs, i.e. kubectl, helm, trivy, velero) plus Rekor proof.
- **Why:** SHA256 matches whatever bytes the attacker publishes. cosign
  + Rekor gives tamper-evident transparency log. SLSA Level 3 prereq.
- **Files:** `download-binaries.js` refactor, bundle cosign itself for
  verification, pin public keys per upstream.
- **Status:** [ ] NOT STARTED
- **Docs:** https://docs.sigstore.dev/cosign/verifying/verify/, SLSA v1.0.

### 8.7 Plugin sandbox (web worker)

- **Goal:** Third-party plugins load inside a Web Worker with a
  postMessage API. No direct access to kubeconfigs, DOM, stores, or
  network. Capabilities requested via manifest, user consents once.
- **Why:** Current plugin tiers (core/free/pro/community) are
  license-gated, not capability-sandboxed. As soon as marketplace goes
  live, a malicious plugin could read every kubeconfig on disk.
- **Files:** `src/lib/shared/plugins/sandbox/worker-host.ts`,
  `worker-guest.ts`, capability mediator, manifest schema v2.
- **Status:** [ ] NOT STARTED
- **Tests:** plugin can't read kubeconfig via direct import; plugin can
  request "read cluster X pods" and gets a scoped proxy; capability revoke
  invalidates future calls.
- **Docs:** OWASP ASVS V14 Sandboxing.

### 8.8 Corporate proxy and custom CA support

- **Goal:** Respect `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`; load
  `REQUESTS_CA_BUNDLE` / `SSL_CERT_FILE` for MITM certificates
  transparently used by enterprise SSL inspectors (Zscaler, Netskope,
  BlueCoat).
- **Why:** Today an enterprise install can't reach cloud APIs through
  their required proxy. Hard blocker for adoption in ~60% of large orgs.
- **Files:** `src/lib/shared/api/cli.ts` (inject env into spawns), new
  `src/lib/shared/config/proxy.ts` with autodetection + explicit override
  UI in Settings.
- **Status:** [ ] NOT STARTED
- **Tests:** unit test that spawned command env includes proxy vars when
  set; settings UI overrides env.

### 8.9 SIEM export for audit trail

- **Goal:** Native forwarders for Splunk HEC, Loki push API, syslog
  RFC 5424/5425 (TCP+TLS), and generic JSONL file tail.
- **Why:** SOC 2 CC7.2 requires monitoring. Enterprises won't accept an
  audit log that stays on the endpoint.
- **Files:** `src/lib/features/cluster-manager/model/audit-trail-export.ts`,
  `model/siem-forwarders/{splunk,loki,syslog,file}.ts`, Settings UI.
- **Status:** [ ] NOT STARTED
- **Tests:** each forwarder batches, retries with backoff, tolerates
  transient failures.

### 8.10 Session lock + master password

- **Goal:** Same flow as 8.1 but for the whole app: after idle timeout
  the UI locks, requires passphrase re-entry. Re-authentication events go
  to audit log.
- **Why:** NIST 800-53 IA-11, most enterprise policies require automatic
  screen lock equivalent.
- **Status:** [ ] NOT STARTED — depends on 8.1 infrastructure.

### 8.11 FIPS 140-3 crypto mode (stretch)

- **Goal:** Optional build flag that routes all crypto through a FIPS
  140-3 validated module (boringssl-fips or OpenSSL FIPS 3.0 provider).
- **Why:** FedRAMP High and DoD IL4+ require FIPS-validated crypto.
  Without it we're locked out of US federal deployments.
- **Status:** [ ] NOT STARTED — scope ~4 weeks, prereq for US gov sales.

### 8.12 SBOM + SLSA provenance

- **Goal:** CycloneDX SBOM generated for every release; SLSA Level 3
  build provenance attested via GitHub Actions OIDC → sigstore.
- **Why:** EU Cyber Resilience Act, US EO 14028, SLSA v1.0.
- **Files:** `.github/workflows/release.yml` step + SBOM publish to
  releases.
- **Status:** [ ] NOT STARTED.
- **Docs:** https://cyclonedx.org/, https://slsa.dev/spec/v1.0/

---

## Commit Convention

All commits for this roadmap follow the pattern:

```
<type>(scope): description

Refs: ROADMAP Phase X.Y
```

Types: `feat`, `fix`, `refactor`, `test`, `chore`
Scopes: `cluster-mgr`, `health`, `helm-catalog`, `capacity`, `perf`, `security`, `fleet`, `vault`, `audit`, `updater`, `sandbox`
