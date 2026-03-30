# Runtime Operations

How ROZOOM manages cluster connections, data refresh, and recovery.

---

## Data Profiles

Data profiles control API pressure, refresh rates, and concurrency for the entire app.
Select in: Dashboard -> Fleet Control Plane -> Fleet Settings.

| Profile      | Core refresh | Derived refresh | Streams | Auto diagnostics | Max card refresh | Use case                                 |
| ------------ | ------------ | --------------- | ------- | ---------------- | ---------------- | ---------------------------------------- |
| **Realtime** | 10s          | 20s             | Yes     | Yes              | 8                | Fast LAN, few clusters, active debugging |
| **Balanced** | 30s          | 45s             | Yes     | Yes              | 8                | Default. Moderate load for daily work    |
| **Low Load** | 60s          | 120s            | No      | No               | 1                | Slow/metered network, limited API quota  |
| **Fleet**    | 90s          | 180s            | No      | No               | 12               | 50-100 clusters, background summary only |
| **Manual**   | 300s         | 300s            | No      | No               | 0                | On-demand only. Zero background activity |

### Runtime Budget per Profile

| Setting                     | Realtime | Balanced | Low Load | Fleet      | Manual     |
| --------------------------- | -------- | -------- | -------- | ---------- | ---------- |
| Max active clusters         | 3        | 2        | 1        | 1          | 1          |
| Max warm clusters           | 4        | 4        | 2        | 4          | 1          |
| Max concurrent connections  | 24       | 16       | 6        | 20         | 2          |
| Max concurrent refreshes    | 6        | 5        | 2        | 6          | 1          |
| Max concurrent diagnostics  | 4        | 3        | 1        | 2          | 0          |
| Max concurrent heavy checks | 8        | 4        | 1        | 2          | 0          |
| Auto-suspend inactive       | No       | Yes      | Yes      | Yes        | Yes        |
| Network sensitivity         | fast     | normal   | slow     | slow       | unstable   |
| Metrics read policy         | eager    | cached   | cached   | reuse_only | reuse_only |

---

## Cluster Runtime States

Each cluster connection has a runtime state:

| State          | Description                                                      |
| -------------- | ---------------------------------------------------------------- |
| **active**     | User is viewing this cluster. Full refresh and streaming active. |
| **warm**       | Recently viewed. Background refresh continues at reduced rate.   |
| **background** | On dashboard. Lightweight refresh only (pod/deployment counts).  |
| **offline**    | Marked offline by user. No connections.                          |
| **degraded**   | Recent errors detected. Recovery window active (see below).      |

---

## Recovery Window (Degraded Mode)

When a watcher or kubectl command fails, the cluster enters **degraded** state:

1. Runtime detects transport error (timeout, connection refused, auth failure)
2. Cluster marked as `degraded` in `cluster-runtime-manager.ts`
3. A **5-minute recovery window** starts
4. During recovery: data still refreshes, but runtime shows warning banner
5. Each successful refresh reduces the degradation signal
6. After 4-5 consecutive successful refreshes, runtime exits degraded mode
7. UI shows: "Cluster runtime is recovering" with explanation

**Why**: Prevents flapping between ok/error states during transient network issues.
Without this, a single timeout would flash the UI between states every 30 seconds.

**Override**: Click the **Update** button (visible in degraded/stale states) to force immediate retry.

---

## Dashboard Card Sorting

Fleet dashboard sorts cluster cards by health:

1. **Error clusters first** (errors in last health check)
2. **Lowest health score** next (most problems at top)
3. **Healthy clusters** at bottom (score 85+)
4. **No data** clusters at very bottom

Within the same score tier, clusters sort by environment priority:
`prod > production > qual > qa > uat > staging > stage > test > dev > sandbox > shared > local`

Custom drag-and-drop order overrides health sorting when enabled.

---

## Table Sorting

All workload tables (Pods, Deployments, etc.) sort by **problem severity**:

1. Default sort: `problemScore` descending (most problematic rows first)
2. Problem indicators: restart count, not-ready status, failed phase, missing probes
3. Secondary sort: name alphabetical
4. User can click column headers to change sort

### Pagination

All tables paginated at **100 rows per page** (configurable: 50/100/200/500).
Page navigation at bottom: first/prev/1-2-3-4-5/next/last.

---

## Watchers and Pollers

### Stream Watchers

Used for real-time updates when Data Profile allows streams:

| Resource | Watcher type               | Reconnect                    |
| -------- | -------------------------- | ---------------------------- |
| Pods     | kubectl watch (stream)     | Auto-reconnect on disconnect |
| Events   | kubectl watch (warnings)   | Auto-reconnect               |
| Nodes    | kubectl watch (conditions) | Auto-reconnect               |

Stream watchers are disabled in Low Load, Fleet, and Manual profiles.

### Background Pollers

Periodic kubectl commands for non-streaming data:

| Check                            | Interval                  | Cache TTL | Heavy? |
| -------------------------------- | ------------------------- | --------- | ------ |
| Pod list                         | Core refresh rate         | 30s       | No     |
| Deployment/DaemonSet/StatefulSet | Core refresh rate         | 30s       | No     |
| Node utilization (top nodes)     | 60s                       | 60s       | No     |
| Health checks (37 checks)        | Derived refresh rate      | 60s       | Yes    |
| Config diagnostics               | On-demand + first load    | 60s       | Yes    |
| Certificate expiry               | On-demand                 | 300s      | Yes    |
| etcd health                      | On-demand (Overview only) | 60s       | Yes    |
| Deprecation scan (pluto)         | On-demand                 | 300s      | Yes    |
| Compliance scan (kubescape)      | On-demand                 | 300s      | Yes    |
| Backup audit (velero)            | On-demand                 | 300s      | Yes    |

### Concurrency Budget

kubectl commands are rate-limited by the runtime budget:

- **maxConcurrentExecs: 6** (default) - max parallel kubectl processes
- **maxConcurrentWatches: 2** (default) - max parallel stream watchers
- Commands queue when budget is full
- Coalesced reads: duplicate GET commands within 5s are merged

---

## Auto-Refresh Rotation

On the fleet dashboard with multiple clusters:

1. Only `maxDashboardCardAutoRefresh` clusters refresh simultaneously
2. Other clusters wait in a rotation window
3. Window rotates every refresh cycle
4. Prevents API storm when 50-100 clusters are visible

Example with Balanced profile (8 max):

- 20 clusters visible: 8 refresh, then next 8, then remaining 4
- Each group gets ~30s before rotation

---

## Diagnostic Phases

When a cluster card loads on the dashboard:

1. **Lightweight refresh** - pods, deployments, replicasets (fast, ~3s)
2. **Config diagnostics** - resources hygiene, probes, QoS, HPA, VPA, PDB, topology, security (5-15s)
3. **Health diagnostics** - certificates, etcd, APF, admission webhooks, blackbox probes (10-30s)
4. **Scores computed** - Health Score and Cluster Score calculated from all checks

Phases 2 and 3 run sequentially after phase 1 completes.
On subsequent refreshes, only phase 1 runs (diagnostics cached for 60s).

---

## For Developers

### Key Files

```
shared/lib/
  cluster-runtime-manager.ts    - Runtime states, budget, degraded mode
  dashboard-data-profile.svelte.ts - 5 data profiles with all settings
  auto-refresh-rotation.svelte.ts  - Dashboard card rotation logic
  background-pollers.ts           - Background polling lifecycle

features/check-health/
  model/watchers.ts              - Watcher scheduling, concurrency limits
  model/cache-store.ts           - Health check store, cache persistence
  model/collect-cluster-data.ts  - Data collection orchestrator
  model/stream-watchers/         - Real-time pod/resource streaming

shared/api/
  kubectl-proxy.ts               - kubectl command execution, coalescing, timeouts
```

### Adding a New Check

1. Create `check-health/api/check-{name}.ts` with check function
2. Add to `collect-cluster-data.ts` in the appropriate phase
3. Add types to `check-health/model/types.ts`
4. Add UI panel in `widgets/cluster/ui/{name}.svelte`
5. Wire into cluster score if it affects scoring (`cluster-score.ts`)

### Tuning Refresh Rates

Override via environment variables:

```bash
VITE_KUBECTL_MAX_PARALLEL=12     # More parallel commands
```

Or programmatically via Fleet Settings panel on dashboard.

---

## Building Desktop Packages Locally

### Prerequisites

- Node.js >= 20, pnpm
- Rust toolchain (stable)
- Tauri system dependencies: https://tauri.app/v2/

### Linux (DEB + RPM)

```bash
cd dashboard-app
pnpm install
pnpm download:binaries
pnpm tauri build --bundles deb,rpm
# Artifacts: src-tauri/target/release/bundle/deb/*.deb
#            src-tauri/target/release/bundle/rpm/*.rpm
```

Or via Docker (no local Rust needed):

```bash
cd dashboard-app
export DOCKER_BUILDKIT=1
docker build -t k8s-dashboard-app -f Dockerfile_linux_new.ver .
docker run -d --name build k8s-dashboard-app sleep infinity
docker cp build:/app ./local-copy
docker rm -f build
# Artifacts in local-copy/deb/ and local-copy/rpm/
```

### macOS (DMG)

```bash
cd dashboard-app
pnpm install
pnpm download:binaries
# Apple Silicon (M1+):
pnpm tauri build --target aarch64-apple-darwin --bundles app,dmg
# Intel:
pnpm tauri build --target x86_64-apple-darwin --bundles app,dmg
# Artifact: src-tauri/target/*/release/bundle/dmg/*.dmg
```

If macOS quarantines the app after install:

```bash
xattr -dr com.apple.quarantine /Applications/ROZOOM*.app
```

### Windows (MSI + NSIS)

```bash
cd dashboard-app
pnpm install
pnpm download:binaries
pnpm tauri build --bundles msi,nsis
# Artifacts: src-tauri/target/release/bundle/msi/*.msi
#            src-tauri/target/release/bundle/nsis/*.exe
```

### Linux ARM64 (cross-compile from x64)

```bash
sudo apt-get install gcc-aarch64-linux-gnu g++-aarch64-linux-gnu
rustup target add aarch64-unknown-linux-gnu
cd dashboard-app
pnpm install
pnpm download:binaries
pnpm tauri build --target aarch64-unknown-linux-gnu --bundles deb
```

### Tests Only (no desktop build)

```bash
cd dashboard-app
pnpm install
pnpm run check          # format + lint + types
pnpm vitest run         # unit + contract tests
pnpm run build          # web build only
```

Or via Docker:

```bash
docker build --target=test -t dashboard-tests -f Dockerfile_linux_new.ver .
```
