# Contributing to ROZOOM - K8s Linter IDE

Thank you for your interest in contributing! This guide will help you get started quickly.

## Quick Start

```bash
git clone https://github.com/ceh13-community/rozoom.git
cd dashboard-app
pnpm install
pnpm download:binaries
pnpm tauri dev
```

## Before You Start

1. Read `dashboard-app/README.md` for development setup
2. Browse `dashboard-app/docs/` for architecture guides per section
3. Run the test suite: `pnpm vitest`
4. Run formatting: `pnpm format`

## How to Contribute

### Bug Reports

Use the **Bug Report** issue template. Include:

- Steps to reproduce
- Expected vs actual behavior
- Cluster type (EKS, GKE, minikube, RKE, etc.)
- Screenshots if UI-related

### Feature Requests

Use the **Feature Request** issue template. Describe:

- Use case (what problem does this solve?)
- Proposed solution
- Which section it belongs to (Workloads, Network, Security, etc.)

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make changes with tests
4. Run the full gate:
   ```bash
   pnpm format
   pnpm run check
   pnpm vitest
   ```
5. Commit with conventional commit messages:
   - `feat:` - new features
   - `fix:` - bug fixes
   - `refactor:` - code changes without behavior change
   - `docs:` - documentation only
   - `test:` - test additions/fixes
   - `style:` - formatting, CSS changes
   - `chore:` - maintenance, dependencies
6. Submit a PR using the PR template

### What Makes a Good PR

- **Small and focused** - one feature or fix per PR
- **Tests included** - add/update tests for your changes
- **Docs updated** - update relevant doc in `dashboard-app/docs/`
- **No regressions** - full test suite passes
- **Follows existing patterns** - use shared components, consistent naming

## Architecture Overview

### Project Structure (Feature Sliced Design)

```
dashboard-app/
  src/
    routes/                    # SvelteKit pages
      dashboard/
        +layout.svelte         # Main layout (sidebar + workloads menu)
        clusters/[slug]/       # Cluster detail page
          +page.ts             # Route loader + workload validation
          +page.svelte         # Renders ClusterPage
    lib/
      app/                     # App-level config (styles, themes)
      shared/                  # Shared utilities, UI primitives
        ui/                    # Button, Input, Sheet, Badge, LoadingDots...
        api/                   # kubectl-proxy, helm, cli, in-app-browser
        lib/                   # Helpers (time, text, confirm, tauri-runtime)
        model/                 # Shared types (clusters, workloads)
        config/                # Tooling config, theme config
      entities/                # Domain entities (cluster, pod)
      features/                # Business logic modules
        check-health/          # Health checks, node metrics, certificates
        backup-audit/          # Velero backup management
        compliance-hub/        # Kubescape + kube-bench
        shell/                 # Terminal/shell sessions
        metrics-sources/       # Metrics source detection
        workloads-management/  # RBAC scanner, config deps, ingress health
      widgets/                 # Complex UI components
        datalists/ui/          # All workload list pages
          common/              # Shared details components
          pods-list/           # Pods page + workbench
          deployments-list.svelte
          configuration-list.svelte  # 20+ config resource types
          network/             # Services, Ingress, Endpoints
          storage/             # PVCs, PVs, StorageClasses
          access-control/      # RBAC resources
          custom-resources/    # CRDs
          nodes-list/          # Nodes status
          triage/              # Global Triage
        cluster/ui/            # Cluster Ops panels
        sidebar/               # Main sidebar
        menu/                  # Workloads menu
        shell/                 # Shell window
        workload/              # Workload routing + display
      pages/                   # Page-level components
        cluster/               # Cluster page workspace + config
  src-tauri/                   # Rust backend (Tauri)
    binaries/                  # Bundled CLI tools (kubectl, helm, etc.)
  docs/                        # Internal documentation (18 files)
```

### Key Patterns

**Workload Page Registration** - 4 files to touch:
1. `workload-route-registry.ts` - component loader + props
2. `+page.ts` - VALID_WORKLOADS array
3. `cluster-page-workspace.ts` - VALID_WORKLOADS Set
4. `menu/ui/workloads.svelte` - sidebar menu item

**Details Sheet Portal** - all details sheets render via `DetailsSheetPortal` (DOM portal to body) for correct fixed positioning.

**Traffic Chain** - `ResourceTrafficChain` resolves resource dependencies on-demand via kubectl API. Supports 20 resource types.

**Metrics Badge** - `ResourceMetricsBadge` polls `kubectl top` every 30s. For pods, computes % from container limits/requests. For nodes, includes disk from kubelet stats.

### Themes

3 built-in themes in `src/lib/app/styles/themes/`:
- `dark.css` - dark theme (default)
- `light.css` - light theme
- `k9s.css` - retro terminal theme (requires specific overrides for risk badges, etc.)

When adding colored elements, ensure they work on all three themes.

For a step-by-step guide on adding new themes, see [`src/lib/shared/theme/THEMING.md`](dashboard-app/src/lib/shared/theme/THEMING.md).

## Shared Components Reference

Before creating new components, check existing ones. In dev mode, visit [`/dev/ui-catalog`](http://localhost:1420/dev/ui-catalog) for a live interactive catalog of all shared UI components.

### UI Primitives (`$shared/ui/`)

| Component | Purpose |
|-----------|---------|
| `Button` | All buttons (loading/success states via `loadingLabel` prop) |
| `LoadingDots` | Animated "..." for loading states |
| `DetailsSheetPortal` | Portal wrapper for all side-panel details sheets |
| `TableEmptyState` | Empty state for tables |
| `Input`, `Badge`, `Sheet`, `Card` | Standard UI elements |

### Details Sheet Components (`common/`)

| Component | Purpose |
|-----------|---------|
| `DetailsSheetHeader` | Header with title + action buttons |
| `DetailsMetadataGrid` | Properties grid (labels, annotations, fields) |
| `DetailsEventsList` | Events section with loading/error states |
| `DetailsExplainState` | Collapsible watcher/runtime debug info |
| `ResourceTrafficChain` | Auto-resolving dependency chain (20 resource types) |
| `ResourceMetricsBadge` | CPU/Memory/Disk inline progress bars |
| `PvcUsageBar` | PVC disk usage from kubelet stats |
| `ResourceActionsMenu` | Unified dropdown menu (Show details, Edit YAML, etc.) |
| `ResourceYamlWorkbenchPanel` | Unified YAML viewer panel |

### Workload Components

| Component | Purpose |
|-----------|---------|
| `ResourceYamlSheet` | YAML editor with kubeconform, breadcrumb, diff |
| `ResourceLogsSheet` | Log viewer with streaming |
| `ResourceDetailsSheet` | Generic details for STS, RS, Jobs, CronJobs |
| `MultiPaneWorkbench` | Investigate panel (1/2/3 panes) |
| `WorkloadBulkActions` | Bulk selection toolbar |

## Adding a New Page

### New Workload List Page

See `dashboard-app/docs/workloads.md`

### New Cluster Ops Page

1. Create panel: `src/lib/widgets/cluster/ui/my-panel.svelte`
2. Create wrapper: `src/lib/widgets/datalists/ui/cluster-health/my-panel.svelte`
3. Export: `src/lib/widgets/cluster/index.ts`
4. Register in 5 files:
   - `workload-route-registry.ts` (loader + props)
   - `+page.ts` (VALID_WORKLOADS)
   - `cluster-page-workspace.ts` (VALID_WORKLOADS)
   - `cluster-page-workload-config.ts` (CLUSTER_HEALTH_WORKLOADS + label)
   - `menu/ui/workloads.svelte` (sidebar item)

### New Configuration Resource

See `dashboard-app/docs/configuration.md` -> "Adding a New Configuration Resource"

## Code Standards

- **TypeScript strict** - no `any`, no implicit returns
- **Svelte 5 runes** - use `$state`, `$derived`, `$effect` (not stores for new code)
- **Component naming** - PascalCase for components, kebab-case for files
- **Icons** - use `@lucide/svelte/icons/*`, consistent per action type
- **Loading states** - use `LoadingDots` component, never static "..."
- **Error handling** - surface errors to user via Alert/toast, log with console.warn
- **Notifications** - use `ActionNotificationBar` + `notifySuccess`/`notifyError`
- **Action menus** - section labels (Manifest/Diagnostics/Rollout/Dangerous)
- **Pure functions** - model modules are pure `(input) -> result`, no side effects
- **Details sheets** - always use `DetailsSheetPortal` wrapper
- **Secrets** - never commit `.env.local`, credentials, tokens

## Environment Variables

See `dashboard-app/.env.example` for all available options:

| Variable | Purpose |
|----------|---------|
| `PUBLIC_SENTRY_DSN` | Sentry error tracking DSN |
| `VITE_ENABLE_RUNTIME_FILE_LOGS` | Enable file-based logs |
| `VITE_ENABLE_VERBOSE_RUNTIME_LOGS` | Verbose tracing (WARNING: can freeze UI) |
| `VITE_ENABLE_PODS_STREAM_WATCH` | Enable pod streaming watcher |

## Questions?

Open a GitHub Discussion or check existing docs in `dashboard-app/docs/`.
