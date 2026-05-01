# CLAUDE.md - Development Guide

This is the private development sandbox for ROZOOM - K8s Linter IDE.
Public release repo: `ceh13-community/rozoom` (generated from `release/prepare-public-repo.sh`).

## Repo structure

- `dashboard-app/` - main Svelte/Tauri desktop application
- `release/` - release staging (gitignored, never committed)
- `release/prepare-public-repo.sh` - generates clean public repo from current state
- `mobile-app/` - mobile prototype (not included in public release)

## Architecture

Feature-Sliced Design. Key layers:

```
src/
  routes/          # SvelteKit pages
  lib/
    app/           # App config, styles, themes
    shared/        # UI primitives, API layer, stores, plugins
    entities/      # Domain models (cluster, pod, deployment, config)
    features/      # Business logic (check-health, backup-audit, shell, ...)
    widgets/       # Complex UI (datalists, sidebar, menu, cluster ops panels)
    pages/         # Page-level components (cluster-page, dashboard-page)
```

## Tech stack

- Svelte 5 (runes: $state, $derived, $effect)
- SvelteKit with adapter-static
- Tauri v2 (Rust backend, plugin-shell for sidecars)
- TypeScript strict mode
- Tailwind CSS + tailwind-variants
- bits-ui for headless components
- Vitest + Testing Library + Playwright

## Commands

```bash
cd dashboard-app
pnpm install
pnpm download:binaries        # fetch kubectl, helm, stern, velero, etc.
pnpm dev                      # vite dev server (port 1420)
pnpm tauri dev                # desktop app with Rust backend
pnpm run check                # prettier + eslint + svelte-check
pnpm vitest run               # 476 test files, 2486 tests
pnpm run build                # production build
pnpm format                   # auto-format all files
```

## Code conventions

- Svelte 5 runes only ($state, $derived, $effect) - no legacy stores for new code
- TypeScript strict - no `any`, no implicit returns
- Icons from `$shared/ui/icons` (re-exports @lucide/svelte)
- Loading states use `LoadingDots` component, never static "..."
- Error handling: surface via Alert/toast, log with console.warn
- Details sheets always use `DetailsSheetPortal` wrapper
- Action menus: section labels (Manifest/Diagnostics/Rollout/Dangerous)
- Model modules are pure functions: `(input) -> result`, no side effects
- ESLint errors: never fix by changing runtime logic, use eslint-disable only

## Commit style

- Conventional commits: feat:, fix:, chore:, docs:, refactor:, test:
- No Co-Authored-By lines
- No em-dashes - use regular hyphens
- Communicate in Ukrainian

## Adding a new workload page

1. `workload-route-registry.ts` - component loader + props
2. `+page.ts` - VALID_WORKLOADS array
3. `cluster-page-workspace.ts` - VALID_WORKLOADS Set
4. `menu/ui/workloads.svelte` - sidebar menu item
5. `cluster-page-workload-config.ts` - WORKSPACE_WORKLOAD_OPTIONS + label

## Adding a theme

See `src/lib/shared/theme/THEMING.md`

## Key files

| What | Where |
|------|-------|
| Global watchers | `src/lib/features/check-health/model/watchers.ts` |
| kubectl proxy | `src/lib/shared/api/kubectl-proxy.ts` |
| Cluster page | `src/lib/pages/cluster/ui/cluster-page.svelte` |
| Fleet dashboard | `src/lib/pages/dashboard/ui/dashboard-page.svelte` |
| Data profiles | `src/lib/shared/lib/dashboard-data-profile.svelte.ts` |
| Network recovery | `src/lib/shared/lib/network-recovery.ts` |
| Fleet heartbeat | `src/lib/features/check-health/api/fleet-heartbeat.ts` |
| Feature capability cache | `src/lib/features/check-health/model/feature-capability-cache.ts` |
| Multi-pane workspace | `src/lib/pages/cluster/model/cluster-page-workspace.ts` |
| Plugin registry | `src/lib/shared/plugins/registry.ts` |
| Background pollers | `src/lib/shared/lib/background-pollers.ts` |

## Release workflow

1. Make changes in this sandbox repo (dashboard-app/)
2. Run CI: `pnpm run check && pnpm vitest run && pnpm run build`
3. Update CHANGELOG.md and version in package.json + tauri.conf.json + Cargo.toml
4. Commit and push to ceh13-community/svelte-dashboard
5. Run: `bash release/prepare-public-repo.sh`
6. Push to ceh13-community/rozoom (see script output for commands)
7. Trigger build: `gh workflow run "CI/CD for Tauri App" --repo ceh13-community/rozoom`

## What NEVER goes to public repo

- This CLAUDE.md file
- .env.local with real credentials
- release/ directory
- mobile-app/ directory
- Git history (public repo is always squashed to 1 commit)
- Internal domain names (gtar.io, panel-dev)
- Sentry org/project defaults (must be empty strings)
- Pricing, trial periods, "Pro" tier labels
- Any AI/assistant traces in code or commits

## Bundled CLI tools (20)

kubectl, helm, kustomize, kubeconform, pluto, stern, velero, yq, aws, gcloud, doctl, hcloud, oc, az, curl, doggo, grpcurl, websocat, tcping, trivy

All downloaded by `download-binaries.js`, stored in `src-tauri/binaries/` (gitignored).

## Supported clusters (18 types)

EKS, GKE, AKS, DigitalOcean, Hetzner, Oracle OKE, Rancher, kubeadm, K3s, RKE2, OpenShift, minikube, Kind, K3d, Docker Desktop, Rancher Desktop, Colima, bare metal
