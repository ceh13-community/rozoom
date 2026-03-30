# Pods List Rewrite Plan

## Goal

Replace the heavy `pods-list.svelte` runtime path with staged, reviewable slices while keeping `pods-lite-list.svelte` available as the safe fallback until the rewrite is complete.

## PR1: Skeleton Rewrite

- Keep snapshot-based pods sync and namespace filtering.
- Introduce a small data adapter for raw `PodItem` to UI row conversion.
- Introduce a minimal row model with only table-critical fields.
- Ship a basic searchable table with cluster/namespace/sync context.
- Explicitly exclude selection, details sheet, workbench, metrics enrichment, and advanced action flows.

## PR2: Interaction Layer

- Add stable selection and row actions on top of the PR1 row model.
- Add details sheet with narrowly-scoped state ownership.
- Restore derived interaction state without coupling it to watcher/bootstrap code.
- Keep workbench state separate from the base table runtime.

## PR3: Advanced Features

- Restore workbench flows.
- Reintroduce metrics enrichment behind a dedicated adapter boundary.
- Add non-critical UX features only after the base table and interaction state are stable.

## Guardrails

- `pods-lite-list.svelte` stays untouched and remains the safe fallback until PR3 is done.
- The base pods table must stay renderable from store snapshot data without details/workbench runtime.
- New logic should prefer pure model helpers over Svelte component-local orchestration.
