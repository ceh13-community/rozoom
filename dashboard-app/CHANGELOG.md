# Changelog

All notable changes to ROZOOM are documented in this file.

## [0.21.0-rc.2] - 2026-04-18

Second release candidate for 0.21. Rolls up the 14 UX workstreams from rc.1 plus a round of post-review fixes on security, reliability, and performance.

### Added

- **GitOps Bootstrap panel** - editor-driven ArgoCD / Flux installation with Helm repo add, install progress, `Application` / `Kustomization` YAML generation, and detection of already-installed controllers
- **Local YAML Backup** - full-cluster or per-namespace export of 14 namespaced + 2 cluster-wide resource kinds to `~/Downloads/rozoom/backup/`, with metadata manifest, list, restore, and delete
- **Helm Catalog advanced** - version autocomplete from repo index, CodeMirror values editor with dark theme, port-forward from the UI with cleanup on panel unmount
- **Helm Catalog presets** - grouped one-click install bundles (observability, policy, security, backup) with batch-level progress
- **Helm page UX overhaul** - search, dry-run preview, per-row rollback, unified humanizer for 8 common Helm error branches
- **Nodes Pressures** - tabbed severity view, taints, flapping detection from 24h history, per-node quick actions
- **Auth & Credentials** - real detection of kubeconfig auth types (token, cert, exec, OIDC), live token-expiry countdown, refresh flow
- **Rotate Certificates** - severity grading, humanized errors, guided wizard, persistent audit trail ConfigMap, cert-manager integration
- **Backup Status** - freshness badges, humanized Velero errors (AWS / Azure / GCP / generic), restore confirm, telemetry
- **Version Audit** - upgrade flow, severity grading, freshness
- **Certificate expiry notifications** - Bell icon panel driven by a background watcher
- **Cluster auth-expired state** - card-level surfacing of 401 / 403 / `exit status 255` via word-boundary regex
- **Resource pressure fallback** - requests-vs-allocatable estimates for clusters without metrics-server, with session-level skip when metrics-server is known available
- **Control plane checks** - `ok` instead of `unknown` for RKE / kubeadm / OpenShift clusters; tightened `/readyz` 404 detection so verbose output no longer triggers bogus `/healthz` fallbacks

### Fixed

- GitOps: `syncArgoCDApp` patches `.operation.sync` on the main Application (dropped `--subresource status`); previously the patch went to `.status.operation` and the ArgoCD controller silently ignored it
- GitOps: Helm install steps now run under an `AbortController`; waitForDeploymentReady polling stops on panel unmount instead of leaking kubectl calls
- GitOps: confirm dialog before `argocd-install` / `flux-install` so a stray click no longer deploys a cluster-wide controller
- YAML Backup: Secrets are excluded by default; export requires an explicit opt-in checkbox plus a plaintext-warning confirm. Prevents accidental credential leaks into synced `~/Downloads`
- YAML Backup: restore writes each manifest to a UUID-suffixed temp path (fixed `yaml-restore-temp.yaml` raced between parallel restores and on failed cleanup)
- YAML Backup: restore dry-run switched from `--dry-run=client` to `--dry-run=server` so admission / quota / immutability are actually validated before apply
- Helm: `--dry-run` bumped to `--dry-run=client` for Helm 3.13+ compatibility; `--wait` / `--rollback` / `--timeout` skipped on dry-run; added `--version` support
- Helm: repo add / repo update errors are now collected and surfaced alongside install failures instead of being silently swallowed; users see the real cause (e.g. network) instead of only "chart not found"
- Helm Catalog: `actionInFlight` is held at batch level during preset loops so concurrent row clicks are properly queued
- Helm Catalog: port-forwards started from the UI are cleaned up on panel unmount via `onDestroy`
- Helm values tempfiles: `sweepHelmValuesTempfiles()` runs at app startup to remove stale `helm-values-*.yaml` left by crashed installs
- Auth & Credentials: replaced hand-rolled YAML scanner with `js-yaml` parse + typed extraction; 1Hz countdown tick paused when tab is hidden
- Rotate Certificates: audit ConfigMap write failures now surface a toast with humanized hint and explicit "Action succeeded; only the audit ConfigMap is missing" note (previously silent `.catch {}`)
- Backup Audit: extracted `humanizeVeleroError` to `$features/backup-audit/model/humanize` with 11 error branches covering AWS / Azure / GCP / generic Velero failures
- 401 / 403 detection: switched auth-error matcher from substring to word-boundary regex so log line numbers like `401ms` or `exit status 2550` no longer trigger false-positive `auth-expired` badges
- metrics-server fallback: `kubectl get pods --all-namespaces` is skipped for clusters where a recent probe saw `kubectl top` working; re-probes after 10 minutes or when metrics-server fails

### Changed

- Extracted per-page humanizers to dedicated modules under `$features/*/model/humanize.ts`, each with unit tests (Helm: 10 tests, Velero: 14, Cert: 10, Cert severity: 8)
- Nodes Pressures: 29 unit tests across humanize / classify / history model modules

### Security

- Secrets are no longer part of the default YAML backup set
- Restore dry-run uses server-side validation against the live cluster

## [0.21.0-rc.1] - 2026-04-03

First release candidate for 0.21 - rolls up 14 UX workstreams merged into `feat/all-ux-combined`. See `chore: bump version to 0.21.0-rc.1` commit for the composition.

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
