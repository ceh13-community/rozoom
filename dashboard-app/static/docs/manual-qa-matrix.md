# Manual QA Matrix

Date: 2026-02-06

Use this matrix for staging and release-candidate validation. Mark each area as `pass`, `fail`, or `n/a` and attach screenshots/log snippets for every failure.

## Cluster Navigation

- cluster manager loads clusters, kubeconfig import, add/remove cluster
- cluster page header renders runtime profile, trust banner, namespace selector
- cluster switching preserves expected state and does not leak previous cluster data

## Core Workloads

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

Check for each section:

- table renders with non-empty data on a healthy cluster
- manual refresh works
- runtime status is honest: live, cached, stale, degraded
- details sheet opens and closes correctly
- YAML/details/workbench actions do not break navigation

## Destructive And Confirmed Actions

- delete pod
- evict pod
- delete network resource
- delete storage resource
- stop port-forward
- change pane layout with hidden tabs
- close cluster debug shell
- close pod debug session and delete temp debug pod
- close pod shell / attach session

Expected result:

- destructive actions always show confirm UI first
- cancel leaves state unchanged
- confirm executes exactly once

## Debug And Support Flows

- `Run debug describe`
- `Open pod debug session`
- shell debug session reuse / cleanup
- `Copy output` and `Export output` in debug describe shell
- `Copy debug bundle` and `Export debug bundle` in configuration details
- request/debug inspector opens and shows recent runtime events

## Observability And Recovery

- optional Gateway API absence does not pin global degraded mode
- metrics noise stays local unless real transport failures continue
- degraded mode recovers after quiet period
- desktop logs are written to the expected log path

## Evidence

- app version / commit
- cluster id(s)
- runtime profile used
- screenshots
- desktop log excerpt
- Sentry issue links if any

## Current Local Evidence

- status: `partial`
- app version / commit:
  - version: `0.7.1`
  - repo HEAD used for the last pushed release-hardening baseline: `09ec683`
- cluster id(s):
  - `minikube`
  - `arn:aws:eks:us-east-2:058264254041:cluster/test-7env`
- runtime profile used:
  - `Balanced`
  - manual/cached pod runtime state also exercised during operator pass
- manual operator pass:
  - operator reported the main release pass as working end-to-end on `2026-02-06`
  - pod debug session, rollout actions, Velero/backup flow, and destructive flow regressions were re-checked during the release hardening cycle
- desktop log evidence:
  - post-pass window around `22:48`-`22:52 CET` showed no new `ERROR` entries
  - newer pod/runtime passes remained clean after expected optional capability noise was suppressed
- screenshots:
  - pod list runtime/trust UI screenshot reviewed on `2026-02-06`
  - follow-up pod list polish removed the always-on healthy cached banner and clarified terminal pod `CPU/Memory` `n/a` states
- local automated support for QA:
  - targeted pod runtime tests: `4 files / 8 tests passed`
  - latest wide release slice: `12 files / 66 tests passed`
  - `pnpm run check`: previously reached `0 errors / 0 warnings`; the most recent rerun still reaches `Getting Svelte diagnostics...` without new diagnostics, which matches the known repo tail-hang behavior
- remaining sign-off still required:
  - formal staging regression pass with this matrix fully marked `pass/fail/n/a`
  - screenshots/log snippets attached for any staging-only failures
