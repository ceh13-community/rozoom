# Runtime Stabilization Audit

Date: 2025-02-18

## Scope

This audit captures the current stabilization baseline after the section rewrites, `cluster-page` runtime cleanup, and focused multi-cluster/perf hardening work.

## What Is Now Bounded

- `cluster-page` orchestration is no longer a single monolithic script.
  - workload policy config moved into `src/lib/pages/cluster/model/cluster-page-workload-config.ts`
  - workspace persistence moved into `src/lib/pages/cluster/model/cluster-page-workspace.ts`
  - sync status helpers moved into `src/lib/pages/cluster/model/cluster-page-sync-status.ts`
  - debug/route trace helpers moved into `src/lib/pages/cluster/model/cluster-page-debug.ts`
  - pane state helpers moved into `src/lib/pages/cluster/model/cluster-page-panes.ts`
  - workspace effect helpers moved into `src/lib/pages/cluster/model/cluster-page-effects.ts`

- Multi-cluster runtime activation is bounded by budget.
  - warm cluster activation now respects `maxWarmClusters`
  - fleet runtime profile keeps `maxConcurrentConnections = 4`
  - fleet runtime profile keeps `maxConcurrentHeavyChecks = 1`
  - fleet prefetch concurrency stays capped at `1`

- Request pressure is bounded in shared runtime primitives.
  - request scheduler stress test covers `100` queued tasks
  - scheduler concurrency remains capped under load
  - repeated multi-cluster prefetch waves stay bounded
  - cache invalidation remains scoped to the targeted cluster/workload

- Telemetry rendering is bounded in the cluster page.
  - workload summary uses `events.slice(-500)`
  - workload perf rows use `listWorkloadEvents().slice(-1200)`
  - watcher rows are capped with `.slice(0, 12)`
  - perf budget alerts are cooldown-throttled per metric

## Current Validation Baseline

Focused stabilization pack status:

- `cluster-page` contracts: passed
- shared runtime tests: passed
- `workloads-fetcher` tests: passed
- workload telemetry tests: passed
- `svelte-check`: `0 errors, 0 warnings`

Validated pack:

- `src/lib/pages/cluster/ui/cluster-page-navigation.contract.test.ts`
- `src/lib/pages/cluster/ui/cluster-page-pods-route-management.contract.test.ts`
- `src/lib/pages/cluster/ui/cluster-page-workspace-vso.contract.test.ts`
- `src/lib/pages/cluster/ui/cluster-page-watcher-telemetry.contract.test.ts`
- `src/lib/pages/cluster/ui/cluster-page-pane-status.contract.test.ts`
- `src/lib/pages/cluster/ui/cluster-page-sync-status.contract.test.ts`
- `src/lib/shared/lib/cluster-runtime-manager.test.ts`
- `src/lib/shared/lib/request-scheduler.test.ts`
- `src/lib/shared/lib/dashboard-data-profile.test.ts`
- `src/lib/features/workloads-management/model/workloads-fetcher.test.ts`
- `src/lib/features/workloads-management/model/workload-telemetry.test.ts`

## Remaining Risks

- This is still a strong bounded-runtime baseline, not proof of real-world `100 cluster` production behavior.
- There is no end-to-end load harness that simulates sustained fleet navigation across many clusters.
- Prefetch is bounded, but the app still depends on the quality of workload selection heuristics and user navigation patterns.
- The current audit is strongest around `cluster-page`, `workloads-fetcher`, scheduler bounds, and telemetry windows.
- Heavy domain-specific paths outside this core baseline should still be watched during broader product rollout.

## Recommended Next Phase

Do not reopen large structural rewrites now.

The next reasonable phase is operational validation:

- add a synthetic fleet-style runtime harness or script for repeated cluster switching
- sample real telemetry from dogfooding sessions
- tune thresholds only when real hot paths show up in telemetry
- keep new section work inside the bounded runtime contracts established here
