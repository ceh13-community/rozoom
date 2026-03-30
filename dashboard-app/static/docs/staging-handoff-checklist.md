# Staging Handoff Checklist

Date: 2026-01-20

Use this checklist for the first staging candidate of `0.7.1`.

## Build Inputs

- app version: `0.7.1`
- repo baseline: `09ec683`
- release binary: `src-tauri/target/release/rozoom-k8s-linter-ide`
- deb: `src-tauri/target/release/bundle/deb/ROZOOM_K8s_Linter_IDE_0.7.1_amd64.deb`
- rpm: `src-tauri/target/release/bundle/rpm/ROZOOM_K8s_Linter_IDE_0.7.1_x86_64.rpm`

## Preflight

- confirm staging operator and date/time window
- confirm staging cluster list
- confirm desktop log path on target host:
  - `~/.local/share/com.rozoom.k8s-linter-ide/logs/logs.log`
- confirm Sentry env values are set:
  - `PUBLIC_SENTRY_DSN`
  - release/upload credentials required by Sentry build integration

## QA Matrix

- run [manual-qa-matrix.md](static/docs/manual-qa-matrix.md)
- attach screenshots for any failure
- attach desktop log excerpts for any runtime failure
- note whether issue reproduced in packaged app or only in dev/runtime build

## Soak

- run [staging-soak-template.md](static/docs/staging-soak-template.md)
- keep the session long enough to cover:
  - section switching
  - cluster switching
  - workbench open/close churn
  - logs stream/poll switching
  - debug describe reuse
  - pod debug session reuse

## Degraded Smoke

- run one pass on a slow/degraded cluster
- run one pass on a cluster without `metrics-server` or with metrics intentionally unavailable
- record:
  - trust banner behavior
  - request/debug inspector behavior
  - cache fallback behavior
  - whether destructive actions remain usable

## Sentry Verification

- trigger one controlled client-side issue in staging
- confirm issue ingestion
- confirm release id and environment tags
- confirm sourcemaps resolve stack traces
- confirm noisy optional-capability issues are not flooding staging

## Distribution Sign-Off

- install `.deb` or `.rpm` on a clean Linux host
- verify app launch, first cluster load, and desktop log creation
- verify manual upgrade path from previous package version
- verify published checksums match:
  - binary: `8be78b2d88cb5fc676d6ecde9f02796181510c2a0c5fb77778cf539af02566cd`
  - deb: `e39ae7ae67f6a8ba04095ec70257c1ea6ab663bd0681de11471755c94f068f07`
  - rpm: `f14c8b86d82bce674f4d2872aa2e815fdf84504a6308a7139756de19da4ed616`

## Exit Criteria

- QA matrix: `pass`
- soak: `pass`
- degraded smoke: `pass`
- Sentry verification: `pass`
- distribution sign-off: `pass`
- final release decision recorded in [release-execution-checklist.md](static/docs/release-execution-checklist.md)
