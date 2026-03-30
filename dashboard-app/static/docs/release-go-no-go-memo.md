# Release GO / NO-GO Memo

Date: 2026-03-12

## Current Decision

- release target: `0.7.1`
- repo baseline: `09ec683`
- decision: `GO for staging candidate`
- decision: `NO-GO for production rollout`

## Why Staging Is Green

- core runtime/reliability hardening is in place
- section `Pause section` / `Resume section` controls are present on heavy sections
- destructive-flow hardening is in place for rollout, shell/session close, and port-forward stop surfaces
- packaging artifacts exist and were verified locally:
  - release binary
  - `.deb`
  - `.rpm`
- local/manual release passes were reported as working end-to-end
- targeted pod/runtime verification is green
- latest release slice remains green

## Why Production Is Still Blocked

- staging QA matrix sign-off is not attached yet
- staging soak with timestamps is not attached yet
- degraded-cluster smoke is not attached yet
- Sentry staging/prod verification is not attached yet
- clean-host install / upgrade sign-off is not attached yet

## Non-Blockers Already Understood

- local Playwright smoke could not be used in this sandbox because `vite preview` is blocked by `listen EPERM`
- Sentry build integration exists and sourcemaps are generated, but release/upload still depends on deploy env credentials
- Tauri native RPM bundling can stall; the documented release fallback produces a verified `.rpm`

## Required Before Production

1. Complete [manual-qa-matrix.md](static/docs/manual-qa-matrix.md) in staging.
2. Complete [staging-soak-template.md](static/docs/staging-soak-template.md) with timestamps and operator sign-off.
3. Run one explicit degraded-cluster / no-metrics-server smoke and attach evidence.
4. Verify Sentry DSN, issue ingestion, release id, and sourcemap upload in staging/prod.
5. Verify install/upgrade on a clean Linux host and attach notes to [packaging-distribution-audit.md](static/docs/packaging-distribution-audit.md).
