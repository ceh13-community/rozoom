# Changelog

All notable changes to ROZOOM - K8s Linter IDE.

## [0.20.0] - 2026-03-30

### Added
- Pre-commit hooks via husky + lint-staged (format + lint on every commit)
- Dev-only UI component catalog at /dev/ui-catalog
- Network recovery listener - auto-recovers clusters after VPN reconnect
- Fleet heartbeat - lightweight /healthz probe every 60s for all clusters
- All resource categories in workspace pane dropdown (Configuration, Access Control, Network, Storage, Custom Resources)
- Grouped optgroup layout in pane workload selector
- Rancher to platform compatibility docs

### Fixed
- Multi-pane layout (2/3) collapsing to 1 when navigating between workloads
- Workspace pane state lost on cluster switch in unpinned mode
- Offline clusters appearing in pane cluster selector
- 47 pre-existing svelte-check type errors (interleaved handlers, duplicate accessors, deprecated components)
- 14 pre-existing eslint errors
- 12 pre-existing prettier formatting issues
- onCopyKubectlDescribe missing from ResourceActionsMenu props

### Changed
- Feature capability cache clears only unreachable entries on network restore (not all)
- Workspace layout and pane config persisted to localStorage for unpinned tabs

## [0.19.0] - 2026-03-29

### Added
- Three-state secret visibility in details sheets (masked -> base64 -> decoded)
- Resource metrics badge with CPU/Memory progress bars for pods and nodes
- Node disk usage indicator from kubelet stats summary API
- PVC disk usage bar in details sheet from kubelet stats
- Traffic chain visualization for all 20 resource types
- Resource Map page in Cluster Ops (full cluster dependency map)
- Problem-first default sorting for RBAC, Namespaces, Custom Resources
- Risk findings with severity levels (critical/high/medium) and colored indicators
- Animated LoadingDots across all loading states
- Shell command history persistence (up to 200 commands)
- Sidebar and workloads menu state persistence
- Loading states for Pod Restarts and Node Pressures pages
- App version display in sidebar footer

### Changed
- Explain this state section made collapsible (auto-opens on sync error)
- Metrics badge moved from header to body in details sheets
- Dropdown menus use dynamic max-height for viewport fitting

### Fixed
- Pod watcher timeout too short for remote clusters in Tauri dev mode
- Pod Attach using kubectl exec instead of kubectl attach
- Kubelet health check key mismatch (kubelet -> kubelet_cadvisor)
- Node-exporter detection limited to monitoring namespace
- Kubescape CRD existence check before triggering scan
- Hetzner backup region placeholder and checksumAlgorithm for S3-compat
- Details sheet fixed positioning via DOM portal
- Sidebar z-index too low (page content overlapped)
- Sidebar icon alignment in collapsed mode

### Refactored
- Unified details sheets with DetailsSheetPortal (10 sheets)
- Unified action menus with ResourceActionsMenu (4 duplicates removed)
- Unified workbench panels with ResourceYamlWorkbenchPanel
- Deleted 7 dead-code files (-695 lines net)

### Documentation
- Comprehensive docs update for all new features
- Updated CONTRIBUTING.md with architecture overview and component reference

## [0.18.0] - 2026-03-29

### Added
- YAML editor: lint gutter, hover tooltips, breadcrumb, multi-doc nav, path copy, diff view
- Managed provider detection for 11 cloud providers
- Hetzner Object Storage backup support with checksumAlgorithm fix

### Fixed
- OVH providerID prefix (ovh:// -> openstack://)
- Dropdown menus overflowing viewport on small screens

## [0.17.0] - 2026-03-27

### Added
- Hetzner Object Storage as backup provider
- Kubeconform schema validation in YAML editor
- K8s-aware autocompletion with snippets

### Fixed
- Cloud import, cross-platform shell, race condition in CLI execution
- Risk findings readability on dark and k9s themes
