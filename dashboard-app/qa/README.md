# QA Workspace

Live QA harnesses, fixtures, and internal runbooks live here.

## Layout

- `qa/live/` browser-driven smoke and parity checks
- `qa/fixtures/` Kubernetes fixtures used by live QA
- `qa/docs/` local QA and debug notes

## Entry Points

```bash
pnpm qa:fixtures:apply
pnpm qa:live:pods
pnpm qa:live:workloads
pnpm qa:live:nodes-status
pnpm qa:live:workbench-parity
```

For local desktop/debug setup, see `qa/docs/local-debug-enablement.md`.
