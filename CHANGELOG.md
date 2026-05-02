# Changelog

All notable changes to ROZOOM - K8s Linter IDE.

## [0.21.0-rc.2] - 2026-04-23

### Added
- Resource pressure fallback for clusters without metrics-server: CPU and memory usage cards are computed from pod requests vs node allocatable when `kubectl top` and kubelet `/proxy/stats/summary` are unavailable. Effective per-pod requests follow the Kubernetes scheduler rule `max(max(initContainer.requests), sum(container.requests))`. Failed pod-list fetches surface as "metrics unavailable" rather than a misleading healthy 0%.
- Per-cluster metrics-server availability cache (10-minute cooldown) skips the cluster-wide pod listing when `kubectl top` was observed working, dramatically reducing refresh cost on large fleets.
- Cards show "CPU requested" / "Memory requested" labels with an explanatory banner when running in fallback mode; mode persists in the overview snapshot cache.
- Phase 8 enterprise security hardening roadmap in `ROADMAP.md` and a new `docs/enterprise-readiness.md` page documenting the path from internal dev-team posture to regulated-environment readiness (SOC 2 Type II, ISO 27001, PCI-DSS 4.0, HIPAA, FedRAMP).
- Sentry credential scrubbing (Phase 8.2): `beforeSend` / `beforeBreadcrumb` strip kubeconfig YAML fields, OIDC client secrets, Authorization headers (Bearer/Basic/custom, case-insensitive per RFC 7235), password fields, bare JWTs, and absolute kubeconfig paths (POSIX and Windows) from every event path - message, exception values, stacktrace frames, breadcrumbs, request, extra, contexts, tags.
- Sentry HMR noise filter: Vite module-swap artefacts (`Importing a module script failed`, Safari/Chrome `module.default` undefined, Svelte lifecycle getter errors) are dropped via `ignoreErrors`; Vite HMR client and cache URLs via `denyUrls`. Prod visibility is preserved because the filters never match production traffic.
- Global sidebar toggle (MessageSquareCode icon) to suppress CLI command toast notifications app-wide; defaults to off; persisted in `dashboard-preferences.json`.

### Fixed
- Pod issues on Overview show "ok" when no crash loops or pending pods are detected, instead of "unknown" when the `podIssues` record is undefined.
- API server health falls back to `/healthz` on RKE and older Kubernetes clusters where `/livez` / `/readyz` return 404. NotFound detection is strict - only transport-layer 404 sentinels trigger the fallback, so verbose `/readyz` output with a 404 in a sub-probe detail line is not treated as endpoint-missing.
- Scheduler and controller-manager on self-managed clusters where these components run as Docker containers (RKE, kubeadm with Docker runtime) show "ok" with an explanation when the API server is healthy, instead of "unavailable".

### Changed
- Sentry guarantee in `SECURITY.md` reworded so the data-storage bullet and the compliance gap table are consistent: the SDK is configured to exclude cluster data and credentials by design, and automated scrubbing enforcement is tracked as Phase 8.2 rather than claimed as already in place.

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
