# Fleet Dashboard - Cluster Cards Page

Real-time overview of all managed Kubernetes clusters. Shows health scores,
capacity metrics, security posture, and configuration drift.

---

## Page Sections

### Header Controls

| Control                    | Description                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Search**                 | Filter clusters by name                                                                                              |
| **Compact / Detailed**     | Toggle card density. Compact for fleet overview, detailed for full diagnostics                                       |
| **List / Grid**            | Layout switch. Grid uses virtual scrolling for 20+ clusters                                                          |
| **Reorder** (GripVertical) | Enable drag-and-drop to reorder cluster cards. Order persists between sessions                                       |
| **Reset** (RotateCcw)      | Reset card order to default (sort by health score, most problematic first). Appears only when custom order is active |
| **Linter**                 | Toggle linter (health checks/diagnostics) on/off. Also available in sidebar for all pages                            |

### Fleet Control Plane (collapsible)

- **Fleet Settings** - data profile (realtime/balanced/low load/fleet/manual), auto-refresh concurrency
- **Runtime Health** - aggregated fleet health status
- **Fleet Drift** - configuration drift detection across clusters

### Cluster Cards

Each card shows:

| Section           | Content                                                                    |
| ----------------- | -------------------------------------------------------------------------- |
| **Header**        | Cluster name, provider badge (EKS/GKE/AKS/Minikube/etc.), status indicator |
| **Status**        | PAUSED (linter off), UNKNOWN/OK/WARNING/CRITICAL (linter on)               |
| **Platform**      | Auto-detected from cluster name/context (EKS, Minikube, Kind, etc.)        |
| **Primary Alert** | Top health risk or "No diagnostics yet" / "Health check failed: {error}"   |
| **Health**        | Composite health score (linter on only)                                    |
| **Capacity**      | Node count, pod utilization, resource allocation                           |
| **HA**            | High availability assessment (replicas, topology spread)                   |
| **Security**      | Pod security standards, network policies, secrets hygiene                  |
| **Upgrades**      | Deprecated API detection (via pluto), version drift                        |

### Card Sorting & Reorder

Default sort: **health score ascending** - most problematic clusters appear first (errors, then low score, then healthy, then clusters without data).

Enable reorder mode (GripVertical icon) to drag-and-drop cards into a custom order. The order is saved in `dashboard-preferences.json` and restored on next visit. Reset button returns to the default health-based sort.

### New in v0.17: Fleet Organization

| Feature           | Description                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Custom groups** | User-defined groups with CRUD operations. Assign clusters to groups, collapse/expand. Persisted in `dashboard-preferences.json`. (`cluster-groups.ts`)  |
| **Smart groups**  | Rule-based auto-grouping by provider/env/tags/name with equals/contains/regex operators. AND/OR logic. First-match-wins assignment. (`smart-groups.ts`) |
| **Saved views**   | Save and quick-switch dashboard filter presets (env, provider, status, tag, group, search). Default view support. (`saved-views.ts`)                    |
| **Safety guards** | Read-only clusters block destructive actions. Production clusters require confirmation. 3-tier risk: locked/caution/safe. (`cluster-safety.ts`)         |

### Global Linter Toggle

Available in both the **sidebar** (all pages) and **dashboard toolbar**:

- **On** (ShieldCheck, green) - health checks, diagnostics, watchers active
- **Off** (ShieldOff, red, pulsing) - all watchers stopped, cards show PAUSED status
- Per-cluster linter checkbox disabled when global linter is off
- State persists between sessions. Default: off

### Cluster Page Header

Visible on all workload pages (Pods, Deployments, etc.):

| Element                     | Description                                                         |
| --------------------------- | ------------------------------------------------------------------- |
| **Workspace panes** (1/2/3) | Multi-pane layout controls                                          |
| **Terminal**                | Local terminal using bundled binaries (kubectl, helm, etc.)         |
| **Runtime**                 | Cluster runtime budget and controls                                 |
| **Inspector**               | Diagnostics inspector panel                                         |
| **Sync indicator**          | Live sync timestamp (e.g. "● 2s ago") - shows on all workload pages |

### Terminal

The Terminal executes commands **locally** via Tauri sidecar binaries - no containers or pods created on the cluster. Available tools: kubectl, helm, stern, velero, pluto, kubeconform, kustomize, yq, aws, gcloud, doctl, hcloud, oc, az, curl, doggo, grpcurl, websocat, tcping, trivy.

Commands auto-inject `--kubeconfig` for the active cluster context. User's OS credentials (AWS, GCP, Azure keys) are used directly.

### Auto-refresh Rotation

The dashboard refreshes cluster data within a concurrency budget:

- `maxConcurrentExecs: 6` - max parallel kubectl operations
- `maxConcurrentWatches: 2` - max parallel stream watchers
- Clusters rotate through the refresh window automatically
- Configurable via Fleet Settings panel or `dashboardDataProfile`

---

## For Developers

### Architecture

```
dashboard-page.svelte             - Main page (cluster list, view controls)
  cluster-info-card.svelte        - Detailed card (full diagnostics)
  cluster-info-card-v2.svelte     - Compact card (health score, key metrics)
  fleet-settings-panel.svelte     - Data profile + refresh settings
  runtime-health-panel.svelte     - Fleet-wide health aggregation
  fleet-drift-panel.svelte        - Configuration drift detection

cluster-page.svelte               - Single cluster workload page
  shell-window.svelte             - Terminal window (local exec via sidecar)
  shell-modal.svelte              - Multi-window terminal container

$features/check-health/
  model/cache-store.ts            - Health check store + selector cache
  model/collect-cluster-data.ts   - Data collection orchestrator
  model/watchers.ts               - Background watcher lifecycle
  model/linter-preferences.ts     - Global + per-cluster linter on/off
  model/stream-watchers/          - Real-time pod/resource streaming

$shared/
  api/cli.ts                      - Sidecar binary execution (execCli, execCliForCluster)
  api/helm.ts                     - Helm install/upgrade/uninstall (--wait --atomic)
  model/resource-store.ts         - Generic watch event store (pods, deploys, etc.)
  lib/auto-refresh-rotation.svelte.ts - Rotation window logic
  lib/background-pollers.ts       - Background polling lifecycle
  lib/dashboard-data-profile.svelte.ts - Profile-based data loading
  lib/cluster-order.ts            - Persisted cluster card order
  ui/cluster-platform.ts          - Platform detection (EKS, Minikube, Kind, etc.)
```

### Memory Management

Health check data can be large (thousands of K8s resources per cluster).
Key optimizations:

- **resource-store.ts**: Mutates arrays in-place instead of spreading on each watch event
- **cache-store.ts**: No deep-clone on in-memory updates; sanitize only when persisting to cache
- **pruneHealthCheckSelectors()**: Clears derived stores for removed clusters
- **pruneHealthCheckData()**: Evicts stale cluster entries from the global store
- **resetDashboardDiagnosticsEntitySnapshots()**: Clears entity cache on page unmount

All cleanup runs in `onDestroy` of the dashboard page.

### View Modes

The `{#key}` wrapper ensures atomic DOM replacement when switching
compact/detailed or toggling the linter - prevents concurrent old+new card trees in memory.

Virtual scrolling (`VirtualCardGrid`) activates for 20+ clusters to avoid
rendering all cards simultaneously.

### Helm Installations

All helm install/upgrade commands include `--wait` and `--atomic`:

- `--wait` ensures all resources are Ready before reporting success
- `--atomic` auto-rolls back on failure
- Applies to: kube-state-metrics, metrics-server, node-exporter, kubescape, trivy-operator, velero, prometheus-stack, kube-armor

### Workload Actions

| Action                 | Available on                                                       | Description                           |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------- |
| **Edit YAML**          | All workloads                                                      | Open YAML editor in workbench         |
| **Investigate**        | Deployments, DaemonSets, StatefulSets, ReplicaSets, Jobs, CronJobs | Dual-pane: logs + YAML                |
| **Run debug describe** | All workloads                                                      | `kubectl describe` via local terminal |
| **Copy describe**      | All workloads                                                      | Copy describe output to clipboard     |
| **Download YAML**      | All workloads                                                      | Export resource YAML                  |

### Testing

```bash
# Unit/contract tests
pnpm vitest run

# E2E tests (Playwright)
pnpm run test:e2e

# Specific dashboard tests
pnpm vitest run dashboard-page
pnpm vitest run dashboard-data-profile
pnpm vitest run dashboard-layout-background-pollers
```

### Data Profiles

| Profile  | Core refresh | Derived refresh | Streams | Auto diagnostics | Use case                  |
| -------- | ------------ | --------------- | ------- | ---------------- | ------------------------- |
| Realtime | 10s          | 20s             | yes     | yes              | Fast LAN, few clusters    |
| Balanced | 30s          | 45s             | yes     | yes              | Default, moderate load    |
| Low Load | 60s          | 120s            | no      | no               | Slow network, limited API |
| Fleet    | 90s          | 180s            | no      | no               | 50-100 clusters           |
| Manual   | 300s         | 300s            | no      | no               | On-demand only            |
