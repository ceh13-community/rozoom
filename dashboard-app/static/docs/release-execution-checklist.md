# Release Execution Checklist

Date: 2026-02-28

Use this document as the release gate for the next production build. Every item must be marked `done`, `partial`, or `blocked`, with evidence linked or pasted inline.

## Release Target

- target version: `0.7.1`
- target commit: `df4abd3`
- release owner:
- candidate build:
  - `src-tauri/target/release/rozoom-k8s-linter-ide`
  - `src-tauri/target/release/bundle/deb/ROZOOM_K8s_Linter_IDE_0.7.1_amd64.deb`
  - `src-tauri/target/release/bundle/rpm/ROZOOM_K8s_Linter_IDE_0.7.1_x86_64.rpm`
- decision: `staging candidate pending environment gates`

## Must-Have Gates

### 1. Runtime Controls

- status: `done`
- gate: section `Pause section` / `Resume section` control is available on heavy sections
- evidence:
  - pods
  - deployments
  - jobs
  - stateful sets
  - configuration
  - overview

### 2. Manual QA Matrix

- status: `partial`
- gate: full regression pass completed from `static/docs/manual-qa-matrix.md`
- evidence:
  - cluster manager
  - overview
  - pods
  - configuration
  - network
  - storage
  - deployments
  - jobs
  - cron jobs
  - stateful sets
  - daemon sets
  - replica sets
  - nodes
  - latest operator evidence:
    - 2026-02-28 manual release pass reported as working end-to-end by operator
    - post-pass desktop log window around `22:48`-`22:52 CET` shows no new `ERROR` entries
    - observed activity includes `kubectl`, `helm`, and `velero` sidecars only
    - healthy cluster metrics path verified via read-only `kubectl top pod -A` on:
      - `minikube`
      - `arn:aws:eks:us-east-2:058264254041:cluster/test-7env`
    - local Playwright smoke harness is present in `e2e/`, but this sandbox blocks `vite preview` with `listen EPERM`, so browser automation cannot be used here as final release evidence

### 3. Staging Soak

- status: `partial`
- gate: soak sheet completed from `static/docs/staging-soak-template.md`
- minimum expectation:
  - repeated route changes
  - cluster switching
  - workbench tab churn
  - logs mode switching
  - debug describe / pod debug reuse
- evidence:
  - environment
  - start/end timestamps
  - error budget notes
  - sign-off
  - current local evidence:
    - repeated section switching and workbench churn were exercised during release hardening
    - no single timestamped staging soak session has been recorded yet

### 4. Degraded Cluster Smoke

- status: `partial`
- gate: manual smoke on at least one degraded/slow cluster and one cluster without metrics-server
- evidence:
  - runtime banner behavior
  - request/debug inspector behavior
  - cache fallback behavior
  - destructive actions still usable
  - current local evidence:
    - historical desktop log includes a metrics API degradation sample:
      - `2026-02-28 21:12:34` `Error from server (ServiceUnavailable): the server is currently unable to handle the request (get pods.metrics.k8s.io)`
    - current healthy metrics path verified on `minikube` and `test-7env`
  - remaining gap:
    - explicit manual pass on a currently degraded or metrics-server-missing cluster still needs sign-off

### 5. Destructive Action Audit

- status: `partial`
- gate: audited actions always show confirm, busy state, normalized error, and single execution
- minimum surface:
  - delete pod
  - evict pod
  - delete network resource
  - delete storage resource
  - stop port-forward
  - rollout restart
  - rollout pause/resume
  - close cluster debug shell
  - close pod debug session
- evidence:
  - screenshots or log excerpts
  - failure copy examples
  - retry behavior notes
  - current repo evidence:
    - shell close actions use shared confirm flow
    - deployment rollout pause/resume/restart normalization covered by tests
    - port-forward stop now exposes explicit busy state on all current surfaces:
      - row/table stop: `Stopping...`
      - workbench/browser-tab stop: `Stopping...`
    - stop actions guard against duplicate execution while the port-forward is stopping
    - optional capability and degraded probe failures no longer log expected cluster gaps as release-noise `ERROR`s:
      - Gateway API resources missing
      - VPA missing
      - kubeadm / etcd helper commands missing with `exit code 127`
      - degraded metrics / service-proxy probe failures

### 6. Sentry Release Verification

- status: `partial`
- gate: staging/prod DSN, ingestion, release tags, and sourcemaps verified
- evidence:
  - staging DSN set
  - test issue link
  - release id
  - sourcemap confirmation
  - prod DSN set
- current repo evidence:
  - runtime integration present and DSN-gated
  - `.env.example` documents `PUBLIC_SENTRY_DSN`
  - `vite.config.js` includes `sentrySvelteKit(...)` production build integration
  - local production build confirms hidden sourcemap generation via Sentry plugin
  - local release build still does not prove staging/prod DSN values, issue ingestion, or release upload credentials

## Should-Have Before GA

### 7. Operator Flow Parity

- status: `partial`
- gate: core resources expose consistent operator actions
- minimum surface:
  - pods
  - deployments
  - jobs
  - stateful sets
- expected actions:
  - logs
  - yaml
  - investigate
  - copy describe
  - run debug describe
  - explain this state

### 8. Packaging Audit

- status: `partial`
- gate: packaged release artifact verified using `static/docs/packaging-distribution-audit.md`
- evidence:
  - `pnpm exec tauri build`
  - AppImage / DEB / RPM output
  - bundled binaries present
  - logs path verified
  - support artifact export verified
  - upgrade/install notes checked
  - current repo evidence:
    - `pnpm build` completed inside `pnpm exec tauri build`
    - native Tauri release binary built:
      - `src-tauri/target/release/rozoom-k8s-linter-ide`
    - observed frontend output sizes:
      - `build`: `12M`
      - `.svelte-kit/output/client`: `3.0M`
    - packaged artifacts:
      - `.deb` present: `src-tauri/target/release/bundle/deb/ROZOOM_K8s_Linter_IDE_0.7.1_amd64.deb`
      - `.rpm` present via verified fallback build:
        - command: `pnpm run build:rpm`
        - artifact: `src-tauri/target/release/bundle/rpm/ROZOOM_K8s_Linter_IDE_0.7.1_x86_64.rpm`
        - `rpm -qip` verified package metadata
        - `rpm -qlp` verified expected payload files
      - checksums captured:
        - binary: `8be78b2d88cb5fc676d6ecde9f02796181510c2a0c5fb77778cf539af02566cd`
        - deb: `e39ae7ae67f6a8ba04095ec70257c1ea6ab663bd0681de11471755c94f068f07`
        - rpm: `f14c8b86d82bce674f4d2872aa2e815fdf84504a6308a7139756de19da4ed616`
      - known Tauri packaging issue remains:
        - `pnpm exec tauri build --bundles rpm -v` can stall after claiming RPM bundling started
        - release workaround is documented in `static/docs/packaging-distribution-audit.md`
      - local `vite preview` for browser smoke is blocked by sandbox `listen EPERM`, so packaged-web smoke still needs host-level sign-off

### 9. Supportability

- status: `partial`
- gate: support path is documented and operator-usable
- evidence:
  - log path documented
  - request/debug inspector documented
  - debug describe documented
  - support bundle or manual artifact collection path documented

## Current Repo Snapshot

- already present:
  - section runtime controls
  - balanced default runtime profile
  - trust banner / request-debug inspector / explain-state surfaces
  - Sentry runtime integration
  - release readiness docs
  - soak template
  - manual QA matrix
  - troubleshooting runbook
  - current automated verification:
    - `pnpm vitest run src/lib/widgets/datalists/ui/pods-list/pod-shell.test.ts`
    - `pnpm vitest run src/lib/widgets/datalists/ui/deployments-list/deployment-rollout.test.ts`
    - `pnpm vitest run src/lib/features/backup-audit/model/store.test.ts`
    - `pnpm vitest run src/lib/widgets/shell/ui/shell-layering-contract.test.ts`
    - `pnpm vitest run src/lib/widgets/datalists/ui/network/port-forwarding-panel.test.ts`
    - `pnpm vitest run src/lib/widgets/datalists/ui/common/port-forward-browser-tab.test.ts`
    - `pnpm vitest run src/lib/widgets/datalists/ui/network-workbench-panel.contract.test.ts`
    - `pnpm vitest run src/lib/shared/lib/dashboard-data-profile.test.ts`
    - `pnpm vitest run src/lib/pages/cluster/ui/cluster-page-adaptive-connectivity.contract.test.ts`
    - latest targeted result:
      - `src/lib/widgets/datalists/ui/common/port-forward-browser-tab.test.ts`
      - `src/lib/widgets/datalists/ui/network/port-forwarding-panel.test.ts`
      - `src/lib/widgets/datalists/ui/network-workbench-panel.contract.test.ts`
      - result: `11 passed`
  - latest wide release slice:
    - `src/lib/widgets/datalists/ui/pods-list/pod-shell.test.ts`
    - `src/lib/widgets/datalists/ui/deployments-list/deployment-rollout.test.ts`
    - `src/lib/features/backup-audit/model/store.test.ts`
    - `src/lib/widgets/shell/ui/shell-layering-contract.test.ts`
    - `src/lib/widgets/datalists/ui/network/port-forwarding-panel.test.ts`
    - `src/lib/widgets/datalists/ui/common/port-forward-browser-tab.test.ts`
    - `src/lib/widgets/datalists/ui/network-workbench-panel.contract.test.ts`
    - `src/lib/shared/lib/dashboard-data-profile.test.ts`
    - `src/lib/pages/cluster/ui/cluster-page-adaptive-connectivity.contract.test.ts`
    - `src/lib/shared/lib/runtime-probe-errors.test.ts`
    - `src/lib/features/check-health/api/check-vpa-status.test.ts`
    - `src/lib/pages/cluster/model/cluster-page-runtime.test.ts`
    - result: `66 passed`
    - `pnpm run check`
      - result: `svelte-check found 0 errors and 0 warnings`
- still needs release evidence:
  - completed staging QA run
  - completed staging soak run with timestamps
  - explicit degraded-cluster pass
  - staged Sentry verification
  - clean-host install / upgrade sign-off
  - final environment sign-off

## Ship Decision

- ready for staging candidate:
- ready for staging candidate: `yes, after environment-only gates`
- ready for production rollout:
- ready for production rollout: `no`
- blockers:
  - staging soak not completed
  - degraded-cluster smoke not completed
  - Sentry staging/prod verification not completed
  - clean-host install / upgrade sign-off not completed
- follow-ups for v1.x:
