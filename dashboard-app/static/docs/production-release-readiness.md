# Production Release Readiness

## Runtime Controls

- Default profile: `Balanced`
- Fast clusters: switch to `Fast LAN`
- Slow or rate-limited clusters: switch to `Slow Internet / Limited API`
- Incident debugging: use `Manual / Custom` if background sync must stay quiet

Cluster-level tuning is available from the cluster page `Runtime` control. Fleet-level defaults are managed from dashboard settings.

## Trust Signals

Users should always be able to answer these questions without opening debug tooling:

- Is this section live, cached, stale, paused, or degraded?
- Which runtime profile is active?
- When did this section last update?
- Why did the UI fall back to cache or manual mode?

Release surfaces that carry these signals:

- cluster header runtime control
- cluster trust banner
- request/debug inspector
- section runtime status cards
- details-level `Explain this state`

## Operator Debug Path

Preferred operator flow:

1. Check the section runtime status.
2. Open `Explain this state` in resource details.
3. Run `Run debug describe` if more cluster context is needed.
4. Open `Request / Debug Inspector` from the cluster header for recent API and kubectl activity.
5. Use `Open pod debug session` only for pod-level interactive debugging.

## Support And Troubleshooting

Collect these artifacts before escalating:

- active runtime profile
- section runtime status screenshot
- cluster trust banner state
- request/debug inspector contents
- `Run debug describe` output for the affected resource
- desktop log file contents

Desktop logs are written by the Tauri app. Current expected path on Linux:

- `~/.local/share/com.rozoom.k8s-linter-ide/logs/logs.log`

## Known Degraded States

### Metrics API unavailable

Expected symptoms:

- trust banner or observability surfaces show degraded or stale state
- metrics cards may stay cached
- request/debug inspector shows metrics-related retries or fallback paths

Typical cluster-side causes:

- `metrics-server` missing
- kubelet TLS mismatch
- metrics endpoints unavailable

### Cached-first fallback

Expected behavior:

- cached snapshot stays visible
- section runtime status moves to `Cached` or `Stale`
- details-level `Explain this state` shows the runtime reason

This is acceptable in production as long as destructive flows and manual refresh still work.

## Release Checklist

- `pnpm run check`
- `pnpm run test:e2e`
- manual smoke on:
  - cluster manager
  - overview
  - pods
  - configuration
  - network
  - storage
  - deployments / jobs / cron jobs / stateful sets / daemon sets
- verify Sentry DSN in deploy environment
- verify desktop log path exists in packaged build
- verify `Run debug describe` and `Open pod debug session` on a real cluster

Supporting documents:

- `static/docs/release-execution-checklist.md`
- `static/docs/release-go-no-go-memo.md`
- `static/docs/staging-handoff-checklist.md`
- `static/docs/manual-qa-matrix.md`
- `static/docs/staging-soak-template.md`
- `static/docs/sentry-rollout-and-monitoring.md`
- `static/docs/packaging-distribution-audit.md`
- `static/docs/operator-troubleshooting-runbook.md`

## Post-Release Monitoring

Watch for:

- new Sentry issues on cluster page and cluster manager
- repeated degraded connectivity switches
- noisy metrics-server failures
- request/debug inspector traces that never settle
- regressions in cached-first e2e behavior
