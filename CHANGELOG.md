# Changelog

All notable changes to ROZOOM - K8s Linter IDE.

## [0.22.0] - 2026-05-11

Promotes `0.22.0-rc.3` to a final release. No runtime changes since `rc.3`;
only the new `design-system/` brand kit was added to the repository for
consumers of the brand assets (logo, colors, components, screenshots).

### Added
- `design-system/` — brand kit (logo, banner, font subsets, color tokens,
  preview pages for components, anatomy, spacing) for downstream usage.

### Notes
- Runtime build is identical to `0.22.0-rc.3`. See `[0.22.0-rc.3]` below for
  the cumulative feature/fix list shipped in this release.

## [0.22.0-rc.3] - 2026-05-09

### Added
- Cluster Ops UX overhaul rounds 1–10 across all 5 Cluster Ops pages
  (Helm Catalog, Helm Releases, Backup Status, Version Audit, Deprecation Scan)
- Fleet Health Overview at the top of Manage Clusters
- Cluster Manager keyboard shortcuts and bulk operations (refresh, set namespace, add tag)
- Cluster Manager Danger Zone — type cluster name to confirm removal
- Connect wizard: kubeconfig preview, live Test Connection, exec-plugin connect method,
  credential risk chip, auto-detect for AWS/GCP/Azure profiles, paste kubeconfig recency
- Cluster card last-refresh state, profile-disabled hints, friendly display name
  (e.g. EKS short name instead of full ARN), Load button tooltips and inline spinner
- Dashboard rotation debugger popover on toolbar
- Cluster card credential risk chip with Shield indicator for high/critical findings
- Helm Catalog: per-chart value overrides, 10-minute install timeouts, F5 NGINX,
  Traefik presets, command console for install/uninstall transcripts
- Helm Releases: clickable revision numbers in history, inspector onboarding hint,
  command console integration for install/upgrade/uninstall/rollback/test
- GitOps Bootstrap: shared command console transcript mirror
- Capacity Intelligence wired to metrics-server with per-workload waste breakdown
- Performance Observability: apiserver RED + CFS throttling via Prometheus service proxy
- Security Audit: RBAC + PSS scanners with transparent findings
- Trivy Hub: local quick scan alongside operator findings, paginated findings table,
  service-proxy fast path, kubectl loop guard for empty tabs
- Plugin Marketplace top-level section with menu visibility wired to plugin toggles
- Sentry Phase 8.2 credential scrubbing with HMR/Vite client URL filtering
- Compliance Hub tabs, preflight, framework selector, remediation
- Backup Audit inline command console for velero install
- Alerts Hub inline command console for prometheus stack install
- Notifications: read/unread state in Bell panel
- Cluster auth cache, credential risk cache, fleet summary, infer-env helpers
- Tokenize-command shared utility for shell-window args parsing
- Cert health graceful fallback when control plane is managed
- Phase 9 roadmap: performance and parallelism via Rust workers (docs)

### Changed
- Menu reorganized: Cluster Ops, Security & Compliance, Observability,
  Plugin Marketplace as top-level section; icon collisions resolved
- Workload labels: Helm → Helm Releases, Cluster Version & Helm Audit → Version Audit,
  Cluster Backup Status → Backup Status, Capacity Intelligence → Cost & Efficiency,
  Plugins → Plugin Marketplace, resourcemap → Resource Map
- Cluster card moves Credentials expired into Primary Alert slot
- Drift badge prefixes label with "Drift" to disambiguate from status badge
- Cluster Manager Scan/Refresh CTA scoped to Cloud Providers only
- /dev/ui-catalog gated to dev and staging only

### Fixed
- Cluster card refresh timestamp on errored health checks and local attempt timestamps
- Cluster card toolbar wrapping on narrow widths
- Cluster card refresh-interval dropdown sync between compact and detailed views
- Cluster score: do not penalize absence of optional observability addons
- Helm catalog: detect installs in custom namespaces, expand port-forward coverage,
  bump JS-level timeout ceiling so helm --timeout 10m wins
- Cluster page Updating dots visibility (text-foreground in loading state)
- Helm panel table-fixed layout to prevent row rendering gaps + reload on nav-back
- RPM build: suppress build-id errors for bundled binaries, glob /usr/bin/rozoom-*
- Cargo: declare url and webkit2gtk as explicit dependencies
- Trivy checksum fetch via direct CDN URL with checksum-skip fallback
- TCPing pinned version, darwin-arm64 fallback, GitHub API rate-limit retry

### Notes
- This is the first CHANGELOG entry since 0.20.0; the 0.21.0-rc.x and 0.22.0-rc.1 / rc.2
  cycles are summarized cumulatively above. See Git history for per-PR detail.

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
