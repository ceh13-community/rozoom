# Changelog

All notable changes to ROZOOM are documented in this file.

## [0.14.0] - 2026-03-15

### Added

- **CodeMirror YAML Editor** - Full-featured YAML editing with ROZOOM dark theme, K8s autocomplete (apiVersion, kind, metadata, spec, containers, probes, volumes, tolerations), YAML linting, code folding, undo/redo, Cmd+F search, Cmd+S save
- **Virtualized Logs Viewer** - Virtual scrolling for 100k+ log lines, line numbers, highlight-in-place search with prev/next navigation and match counter
- **Live Resource Metrics Badges** - CPU/MEM usage bars in pod workbench and node detail headers, polls every 30s, gracefully hides when Metrics API unavailable
- **Cluster Error UX** - Grey "Offline" badge for unreachable clusters, friendly error messages (Cluster unreachable, TLS error, Auth failed, Connection timed out, Cluster not found)
- **CLI Notifications** - Toast notifications for all mutating kubectl/helm commands showing the full command, completion time, and Copy button
- **Helm Catalog** - 23 curated Helm charts for observability, security, and compliance with one-click install

### Fixed

- Metrics endpoint status parsing: correctly distinguishes "not_found" from "unreachable" on cluster cards
- YAML editor async value loading (empty pane on mount)
- Cluster card color consistency when connection errors vs partial check failures

### Security

- Disabled DevTools in production builds
- Added Content Security Policy (CSP)
- Synced version across tauri.conf.json and Cargo.toml
- Removed 20 debug console.log statements from production code

### Documentation

- Added SECURITY.md - security architecture, data access, capability system
- Added PHILOSOPHY.md - project principles, architecture decisions
- Added CHANGELOG.md
- Added .editorconfig

## [0.13.0] - 2026-01-28

### Added

- Helm Catalog page in Cluster Ops with curated charts
- CLI notifications for helm install/upgrade/uninstall
- Manual refresh on dashboard card triggers full diagnostics rescan

### Fixed

- Duplicate Investigate action in Configuration list
- Cache fallback for sync indicator on all workload pages
- Sidebar width and header layout restored

## [0.12.0] - 2025-11-10

### Added

- Fleet Control Plane dashboard with multi-cluster overview
- Cluster health scoring system (0-100)
- Adaptive polling with error streak backoff
- Pod workbench with multi-pane layout (logs + YAML + events)
