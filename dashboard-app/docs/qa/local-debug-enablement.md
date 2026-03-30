# Local Debug Enablement

This repo already has the core pieces needed for desktop debugging:

- Tauri desktop runtime
- embedded `kubectl` / `helm` binaries
- runtime watcher telemetry
- local file logging
- Sentry SDK wiring for client and server

## Recommended Local Profile

Create or update `.env.local`:

```bash
PUBLIC_SENTRY_DSN=
PUBLIC_SENTRY_ENVIRONMENT=development
PUBLIC_SENTRY_ENABLE_IN_DEV=false
SENTRY_ORG=your-org
SENTRY_PROJECT=javascript-sveltekit
SENTRY_AUTH_TOKEN=
SENTRY_ENABLE_SOURCE_MAP_UPLOAD=false
VITE_ENABLE_WORKSPACE_DEBUG_PANEL=true
VITE_ENABLE_RUNTIME_FILE_LOGS=true
VITE_ENABLE_VERBOSE_RUNTIME_LOGS=true
VITE_ENABLE_OVERVIEW_TRACE=true
VITE_ENABLE_WATCHERS_TRACE=true
VITE_ENABLE_KUBECTL_TRACE=true
VITE_ENABLE_BACKGROUND_POLLERS_TRACE=true
VITE_ENABLE_DEVTOOLS_CONSOLE=true
VITE_ENABLE_PODS_STREAM_WATCH=true
```

Use the dedicated debug scripts:

```bash
pnpm dev:rozoom
pnpm tauri:dev:rozoom
pnpm tauri:info
pnpm check
pnpm vitest
```

## Kubernetes Runtime Access

For end-to-end debugging, the local machine must be able to reach a live cluster:

```bash
kubectl config current-context
kubectl get nodes
kubectl get ns
```

This app is easiest to validate against `minikube`, because most desktop regressions in this repo are already exercised there.

## Logs

Desktop runtime logs are written to:

```text
~/.local/share/com.rozoom.k8s-linter-ide/logs/logs.log
```

Useful validation loop:

1. Run `pnpm tauri:dev:rozoom`
2. Open a cluster page
3. Trigger the problematic flow
4. Inspect the runtime debug panel
5. Inspect `logs.log`

When verbose tracing is enabled via `.env.local`, the desktop log file includes:

- `[runtime:overview]` route activation and staged refresh events
- `[runtime:watchers]` queueing, cancellation, skip, and completion events
- `[runtime:kubectl]` command start/finish, duration, bytes, and source metadata
- `[runtime:background-pollers]` global poller teardown events

## Local Sentry Verification

Sentry SDK init is disabled in development unless explicitly enabled.

To test local ingestion in `vite dev` / `tauri dev`, set:

```bash
PUBLIC_SENTRY_DSN=...
PUBLIC_SENTRY_ENABLE_IN_DEV=true
PUBLIC_SENTRY_ENVIRONMENT=local-debug
```

For source map upload during a production-like build, also set:

```bash
SENTRY_AUTH_TOKEN=...
SENTRY_ORG=your-org
SENTRY_PROJECT=javascript-sveltekit
SENTRY_ENABLE_SOURCE_MAP_UPLOAD=true
```

Then run:

```bash
pnpm build:staging
pnpm preview
```

## Expected Outcome

With this profile enabled, the repo supports:

- live cluster reproduction against local kubeconfig
- runtime watcher/debug inspection
- Tauri desktop logs
- browser/server Sentry event capture
- production-like source map upload when credentials and the explicit upload flag are present
