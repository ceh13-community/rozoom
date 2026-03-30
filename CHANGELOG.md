# Changelog

All notable changes to ROZOOM - K8s Linter IDE.

## [0.20.0] - 2026-03-30

### Added
- Pre-commit hooks via husky + lint-staged (format + lint on every commit)
- Network recovery listener - auto-recovers clusters after VPN reconnect
- Fleet heartbeat - lightweight /healthz probe every 60s for all clusters
- All resource categories in workspace pane dropdown (Configuration, Access Control, Network, Storage, Custom Resources)
- Grouped optgroup layout in pane workload selector
- Rancher to platform compatibility docs

### Fixed
- Multi-pane layout (2/3) collapsing to 1 when navigating between workloads
- Workspace pane state lost on cluster switch in unpinned mode
- Offline clusters appearing in pane cluster selector

### Changed
- Feature capability cache clears only unreachable entries on network restore (not all)
- Workspace layout and pane config persisted to localStorage for unpinned tabs

---

## Pre-release History

### [0.19.0]

- Three-state secret visibility in details sheets (masked, base64, decoded)
- Resource metrics badge with CPU/Memory progress bars for pods and nodes
- Node disk usage from kubelet stats, PVC disk usage bar
- Traffic chain visualization for 20 resource types
- Resource Map page (full cluster dependency map)
- Problem-first default sorting for RBAC, Namespaces, Custom Resources
- Risk findings with severity levels and colored indicators
- Shell command history persistence (up to 200 commands)
- Unified details sheets with DetailsSheetPortal (10 sheets consolidated)
- Unified action menus with ResourceActionsMenu (4 duplicates removed)

### [0.18.0]

- YAML editor: lint gutter, hover tooltips, breadcrumb, multi-doc nav, path copy, diff view
- Managed provider detection for 11 cloud providers
- Kubeconform schema validation in YAML editor
- K8s-aware autocompletion with snippets

### [0.17.0]

- Hetzner Object Storage as backup provider
- Cloud import and cross-platform shell improvements

### [0.16.0]

- Velero backup profiles with multi-cloud credential management (AWS S3, Azure Blob, GCP, MinIO)
- Backup audit panel with schedule compliance and recency monitoring
- Configuration details sheet with inline data viewer and decoded secrets

### [0.15.0]

- Storage resource pages (PVCs, PVs, Storage Classes, Volume Snapshots, CSI)
- Access control pages (Roles, RoleBindings, ClusterRoles, Access Reviews)
- Custom Resources page (CRD discovery and generic instance browser)
- Network pages (Services, Ingresses, Endpoints, NetworkPolicies, Gateway API)

### [0.14.0]

- Multi-pane workspace (1/2/3 side-by-side views)
- Pinned tab system with per-workspace state persistence
- Data profiles (realtime, balanced, low-load, fleet, manual)

### [0.13.0]

- Helm release management and one-click Helm Catalog (17+ curated charts)
- GitOps bootstrap wizard (ArgoCD, Flux)
- Certificate rotation panel (EKS, GKE, AKS, kubeadm, K3s, minikube)

### [0.12.0]

- Global Triage (cross-resource problem scanner with impact ranking)
- API deprecation scan via Pluto
- Version audit across fleet
- Fleet drift detection

### [0.11.0]

- Security and compliance: KubeArmor, Trivy Operator, Kubescape integration
- Alerts hub (Alertmanager, Prometheus, K8s Events)
- Metrics source monitoring (kubelet, metrics-server, kube-state-metrics, node-exporter)

### [0.10.0]

- Interactive shell (exec, attach, debug containers)
- Log streaming via stern
- Port forwarding with browser tab integration

### [0.9.0]

- Configuration pages (ConfigMaps, Secrets, HPAs, PDBs, Webhooks, and 10 more)
- Namespace management page

### [0.8.0]

- Workload pages: Pods, Deployments, DaemonSets, StatefulSets, ReplicaSets, Jobs, CronJobs
- Pod Restarts monitoring, CronJobs health monitoring
- Nodes status and Node pressures pages

### [0.7.0]

- Fleet dashboard with cluster cards, health scores, cluster scores
- Auto-refresh rotation for large fleets
- Adaptive connectivity with degradation detection

### [0.1.0 - 0.6.0]

- Initial architecture (SvelteKit 5 + Tauri 2 + TypeScript strict)
- Feature-Sliced Design project structure
- Cluster Manager with kubeconfig discovery
- Bundled CLI tools infrastructure (14 sidecar binaries)
- K9s retro terminal theme
- Three-theme system (dark, light, k9s)
- 18 cluster type auto-detection (EKS, GKE, AKS, Rancher, K3s, minikube, ...)
