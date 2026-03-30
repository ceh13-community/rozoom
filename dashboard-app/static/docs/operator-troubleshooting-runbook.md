# Operator Troubleshooting Runbook

Date: 2025-04-10

## First Response

1. Confirm the cluster and namespace context.
2. Read the section runtime status.
3. Read the cluster trust banner.
4. Open the request/debug inspector.
5. Decide whether the problem is data-path, metrics-path, or resource-specific.

## If Namespaces Or Core Lists Fail

- inspect desktop logs
- inspect request/debug inspector for namespace or watcher errors
- verify desktop runtime is using the Tauri path, not browser fallback
- retry with manual refresh

## If Cluster Runtime Shows Degraded

- check whether the latest errors are real watcher transport failures
- treat missing optional APIs such as Gateway API or VPA as local capability gaps, not global outage
- treat metrics endpoint noise separately from namespace/pod list failures
- allow the adaptive recovery window to clear stale degraded state after quiet period

## If Resource Debugging Is Needed

- use `Run debug describe` first
- use `Open pod debug session` only for pod-local inspection
- collect exported output or debug bundle for escalation

## Support Artifacts To Attach

- screenshot of runtime banner / section status
- request/debug inspector content
- exported debug describe output
- exported network debug bundle when relevant
- desktop log excerpt
- Sentry issue link if present
