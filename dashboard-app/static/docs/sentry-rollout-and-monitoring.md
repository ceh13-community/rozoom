# Sentry Rollout And Monitoring

Date: 2025-06-22

## Runtime Contract

Sentry initialization is gated by `PUBLIC_SENTRY_DSN` and disabled in dev.

Relevant files:

- `src/hooks.client.ts`
- `src/hooks.server.ts`
- `src/lib/shared/config/sentry.ts`

## Staging Rollout Checklist

- set `PUBLIC_SENTRY_DSN` in staging environment
- verify app boots without DSN-related exception
- trigger one controlled client-side error and confirm ingestion
- verify release/environment tags on the event
- confirm source maps are uploaded for the release

## Production Rollout Checklist

- confirm staging event volume and grouping are acceptable
- promote the same release artifact or rebuild with identical commit
- verify production DSN is present
- verify first production events arrive under the expected release

## Monitoring Focus

- cluster page regressions
- cluster manager regressions
- shell/debug flows
- repeated watcher transport errors
- namespace load failures
- optional capability noise being misclassified as fatal runtime errors

## Release Evidence

- Sentry project:
- release id:
- environment:
- sample issue links:
- owner:

## Current Repo Evidence

- `@sentry/sveltekit` is initialized in:
  - `src/hooks.client.ts`
  - `src/hooks.server.ts`
- runtime enablement is gated by `PUBLIC_SENTRY_DSN` in:
  - `src/lib/shared/config/sentry.ts`
  - `.env.example`
- Vite build integration is present in `vite.config.js` via `sentrySvelteKit(...)`
- local production build output confirms Sentry build plugin behavior:
  - source map generation is enabled automatically for production build
  - source map cleanup-after-upload behavior is configured by the plugin
- release caveat still open:
  - no staging/prod DSN value was verified in this local session
  - no controlled staging/prod issue ingestion was verified in this local session
  - no staging/prod release id or sample issue links are attached yet
  - no explicit `SENTRY_AUTH_TOKEN`/organization/project release upload wiring is documented in deploy environment evidence yet
