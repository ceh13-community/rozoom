# Workloads - Resource List Pages

Nine workload list pages provide operational visibility into Kubernetes
resources. Each page follows a unified pattern: data table with sorting,
filtering, column visibility, CSV export, background watcher, selection
with bulk actions, row action menu, detail sheet, and multi-pane
workbench for investigation.

---

## Pages

| Page                        | Resource               | Key Columns                                                                              |
| --------------------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| **Nodes Status**            | nodes                  | Name, Conditions, Roles, Version, CPU, Memory, Disk, Taints                              |
| **Pods**                    | pods                   | Name, Namespace, Status, Containers, Restarts, CPU, Memory, Node, QoS, ControlledBy, Age |
| **Deployments**             | deployments            | Name, Namespace, Ready, UpToDate, Available, Node, Replicas, Status, Age                 |
| **Daemon Sets**             | daemonsets             | Name, Namespace, Nodes, Desired, Current, Ready, Updated, Available, Status, Age         |
| **Stateful Sets**           | statefulsets           | Name, Namespace, Pods, Replicas, Age                                                     |
| **Replica Sets**            | replicasets            | Name, Namespace, Desired, Current, Ready, Age                                            |
| **Replication Controllers** | replicationcontrollers | Name, Namespace, Replicas, Desired, Selector                                             |
| **Jobs**                    | jobs                   | Name, Namespace, Completions, Age, Status                                                |
| **Cron Jobs**               | cronjobs               | Name, Namespace, Schedule, Suspend, Active, LastSchedule, NextExecution, TimeZone, Age   |

---

## Unified Action Menu Structure

All workload action menus follow a consistent sectioned layout:

### Standard Actions (top)

| Action       | Pods | Deploy | DS  | STS | RS  | Jobs | CJ  | Nodes |
| ------------ | :--: | :----: | :-: | :-: | :-: | :--: | :-: | :---: |
| Show details |  Y   |   Y    |  Y  |  Y  |  Y  |  Y   |  Y  |   Y   |
| Logs         |  Y   |   Y    |  Y  |  Y  |  Y  |  Y   |  Y  |   -   |
| Events       |  Y   |   Y    |  Y  |  Y  |  -  |  -   |  -  |   Y   |

### Manifest Section

| Action                | All workloads |
| --------------------- | :-----------: |
| Edit YAML             |       Y       |
| Copy kubectl describe |       Y       |
| Run debug describe    |       Y       |
| Download YAML         |       Y       |

### Diagnostics Section

| Action         | Pods | Deploy | DS  | STS | RS  | Jobs | CJ  | Nodes |
| -------------- | :--: | :----: | :-: | :-: | :-: | :--: | :-: | :---: |
| Investigate    |  Y   |   Y    |  Y  |  Y  |  Y  |  Y   |  Y  |   Y   |
| Scale          |  -   |   Y    |  -  |  Y  |  Y  |  -   |  -  |   -   |
| Trigger now    |  -   |   -    |  -  |  -  |  -  |  -   |  Y  |   -   |
| Suspend/Resume |  -   |   -    |  -  |  -  |  -  |  -   |  Y  |   -   |

### Rollout Section (Deployments, DaemonSets, StatefulSets only)

- Rollout status
- Rollout history
- Rollout restart
- Pause / Resume rollout (Deployments only)
- Undo revision (Deployments only)

### Dangerous Section

| Action          | Pods | Deploy | DS  | STS | RS  | Jobs | CJ  | Nodes |
| --------------- | :--: | :----: | :-: | :-: | :-: | :--: | :-: | :---: |
| Delete          |  Y   |   Y    |  Y  |  Y  |  Y  |  Y   |  Y  |   Y   |
| Evict           |  Y   |   -    |  -  |  -  |  -  |  -   |  -  |   -   |
| Cordon/Uncordon |  -   |   -    |  -  |  -  |  -  |  -   |  -  |   Y   |
| Drain           |  -   |   -    |  -  |  -  |  -  |  -   |  -  |   Y   |

### Pod-Specific Access Actions

Shell, Attach pod, Previous logs, Port-forward preview, Copy kubectl debug, Export incident.

---

## Action Contexts

Each page provides actions in three contexts that stay in sync:

| Context              | Description                                |
| -------------------- | ------------------------------------------ |
| **Row menu (⋮)**     | Three-dot dropdown on each table row       |
| **Details sheet**    | Side panel opened via "Show details"       |
| **Bulk actions bar** | Toolbar shown when checkboxes are selected |

All three contexts offer the same set of actions (with minor exceptions for pod-specific or multi-select actions).

---

## Investigate Workflow

Clicking **Investigate** on any workload opens a dual-pane workbench:

- **Left pane**: Logs (streaming with container selector, follow/pause)
- **Right pane**: YAML editor (syntax highlighting, dirty diff, search, apply)

This is consistent across Pods, Deployments, DaemonSets, StatefulSets, ReplicaSets, Jobs, CronJobs, and Nodes (YAML-only for Nodes).

### YAML Editor Features (CodeMirror 6)

- Syntax highlighting with custom Rozoom dark theme
- YAML syntax validation (js-yaml, multi-document aware)
- Duplicate key detection (scope-aware)
- Indentation checks (tabs, odd spacing)
- Kubeconform schema validation (async, 2s debounce)
- Lint gutter with error/warning markers + lint panel (Ctrl+Shift+M)
- K8s-aware autocompletion (kind, apiVersion, spec fields, 11 snippets)
- Hover tooltips with K8s API documentation (100+ fields)
- Breadcrumb navigation showing current YAML path
- Multi-document navigator dropdown
- YAML path copy (Ctrl+Shift+C) in dot-notation for kubectl/yq
- Side-by-side diff view (@codemirror/merge)
- Fold gutters, search, history, line wrapping

### Traffic Chain Visualization

Details sheets include an auto-resolving traffic chain showing resource dependencies for all resource types:

| Resource                                        | Chain                        | Direction                   |
| ----------------------------------------------- | ---------------------------- | --------------------------- |
| **Ingress/Gateway**                             | ING -> SVC -> DEP -> POD     | Forward                     |
| **Service/Endpoint**                            | SVC -> DEP/STS/DS -> POD     | Forward                     |
| **HTTPRoute**                                   | Route -> SVC -> DEP -> POD   | Forward                     |
| **Deployment/StatefulSet/DaemonSet/ReplicaSet** | Workload -> POD              | Forward                     |
| **Pod**                                         | Owner -> POD, SVC -> POD     | Reverse lookup              |
| **Job**                                         | CronJob -> JOB -> POD        | Owner + children            |
| **CronJob**                                     | CJ -> N jobs                 | Children count              |
| **Node**                                        | NODE -> N/M pods (health)    | Pods on node                |
| **Namespace**                                   | NS -> DEP/STS/SVC/POD counts | Summary                     |
| **ConfigMap/Secret**                            | CM/SEC -> POD (used by)      | Reverse (volumes + envFrom) |
| **PVC**                                         | PVC -> POD (used by)         | Reverse (volumes)           |
| **PV**                                          | PV -> bound PVC              | Claim ref                   |
| **StorageClass**                                | SC -> N PVCs                 | Provisions                  |
| **ServiceAccount**                              | SA -> N pods                 | Used by                     |

Resolution uses: ingress backend refs, service label selectors (matched against pod template labels), pod owner references, volume mounts, envFrom refs. Color-coded badges by resource kind with pod health status indicators.

### PVC Disk Usage

PersistentVolumeClaim details sheet shows real-time disk usage bar resolved from kubelet stats summary API (`/api/v1/nodes/{node}/proxy/stats/summary`). Color-coded: green (<75%), amber (75-90%), red (>90%).

### Resource Metrics Badge

Pod and Node details sheets show inline CPU/Memory metrics with progress bars, auto-polled every 30s via `kubectl top`. For nodes: exact percentages from kubectl. For pods: estimated percentages (CPU relative to 1 core, memory relative to 2Gi) with `~` prefix. Also shown in investigate workbench panel.

### Secrets Three-State Visibility

Secret data values cycle through three states per key (and globally):

1. **Masked** (default): asterisks
2. **Base64**: raw encoded value + copy button
3. **Decoded**: plaintext in green + copy button

Single button cycles: Eye -> KeyRound -> EyeOff.

### Explain This State

Collapsible debug section in Pods, Deployments, StatefulSets, ReplicaSets, Jobs, CronJobs details sheets. Shows: source of truth (live/cached/stale/error), request path, runtime summary, describe command. Auto-opens on sync error.

### State Persistence

User preferences persisted across sessions:

- Sidebar open/closed state (localStorage)
- Workloads menu collapsed state (localStorage)
- Shell command history - up to 200 commands (localStorage)
- Theme, data profile, namespace selections, column visibility, sort preferences, watcher settings

### Resource Map (Cluster Ops page)

Full cluster resource dependency map accessible from Cluster Ops sidebar. Shows all traffic chains grouped by namespace with:

- Ingress -> Service -> Deployment -> Pod chains
- Mounted ConfigMaps, Secrets, PVCs per service
- Pod health status (ready/total)
- Namespace filter and name search

---

## Table Features

| Feature                  | Pods | Deploy/DS/STS/RS/Jobs/CJ |        Nodes         |
| ------------------------ | :--: | :----------------------: | :------------------: |
| Sorting                  |  Y   |       Y (TanStack)       |     Y (TanStack)     |
| Search / filter          |  Y   |            Y             |          Y           |
| Column visibility toggle |  Y   |            Y             |          Y           |
| CSV export               |  Y   |            Y             |          Y           |
| Selection checkboxes     |  Y   |            Y             |          Y           |
| Virtual scrolling        |  Y   |            Y             | Pagination (15/page) |
| Namespace grouping       |  Y   |            Y             | N/A (cluster-scoped) |
| Node grouping            |  Y   |     Deployments only     |         N/A          |
| Watcher controls         |  Y   |            Y             |          Y           |
| Background sync          |  Y   |            Y             |          Y           |

---

## Shared Components

| Component               | Location                                      | Used by                                                           |
| ----------------------- | --------------------------------------------- | ----------------------------------------------------------------- |
| `ResourceYamlSheet`     | `common/resource-yaml-sheet.svelte`           | All 8 workloads with YAML editing                                 |
| `ResourceLogsSheet`     | `common/resource-logs-sheet.svelte`           | All 7 workloads with logs                                         |
| `ResourceActionsMenu`   | `common/resource-actions-menu.svelte`         | Jobs, CronJobs, ReplicaSets, Network, Custom Resources            |
| `ResourceTrafficChain`  | `common/resource-traffic-chain.svelte`        | All details sheets (20 resource types)                            |
| `ResourceMetricsBadge`  | `common/resource-metrics-badge.svelte`        | Pod, Node details sheets + investigate panel                      |
| `PvcUsageBar`           | `common/pvc-usage-bar.svelte`                 | PVC details sheet (kubelet stats)                                 |
| `ResourceYamlWorkbench` | `common/resource-yaml-workbench-panel.svelte` | Custom Resources (unified YAML viewer)                            |
| `DetailsSheetPortal`    | `shared/ui/details-sheet-portal.svelte`       | All details sheets (portal to body for correct fixed positioning) |
| `DetailsExplainState`   | `common/details-explain-state.svelte`         | Pods, Deployments, STS, RS, Jobs, CronJobs (collapsible)          |
| `WorkloadEventsSheet`   | `common/workload-events-sheet.svelte`         | Deployments, DaemonSets, StatefulSets                             |
| `WorkloadBulkActions`   | `common/workload-bulk-actions.svelte`         | All workloads with bulk selection                                 |
| `DetailsHeaderActions`  | `common/details-header-actions.svelte`        | All details sheets                                                |
| `DetailsEventsList`     | `common/details-events-list.svelte`           | All details sheets with events                                    |
| `DetailsMetadataGrid`   | `common/details-metadata-grid.svelte`         | All details sheets                                                |
| `WorkbenchSheetShell`   | `common/workbench-sheet-shell.svelte`         | YAML, Logs, Events sheets                                         |
| `ResourceDetailsSheet`  | `resource-details-sheet.svelte`               | StatefulSets, ReplicaSets, Jobs, CronJobs                         |
| `MultiPaneWorkbench`    | `$shared/ui/multi-pane-workbench.svelte`      | All workloads with investigate                                    |

---

## For Developers

### Architecture

```
$widgets/datalists/ui/
  common/                          - Shared table and sheet components
  pods-list/                       - Pods (custom data-table, workbench, details)
  nodes-list/                      - Nodes (TanStack table, custom details)
  deployments-list/                - Deployments (TanStack + inline details)
  daemon-sets-list/                - DaemonSets (same pattern as Deployments)
  stateful-sets-list/              - StatefulSets (TanStack + generic details)
  replica-sets-list/               - ReplicaSets (TanStack + generic details)
  jobs-list/                       - Jobs (TanStack + generic details)
  cron-jobs-list/                  - CronJobs (TanStack + generic details)
  replication-controllers-list.svelte - ReplicationControllers (minimal)
```

### Adding a New Action to All Workloads

1. Add callback to `ResourceActionsMenu` props (for Jobs/CronJobs/ReplicaSets)
2. Add to per-workload `*-actions-menu.svelte` (for Deployments/DaemonSets/StatefulSets/Nodes)
3. Add to `pod-actions-menu.svelte` (for Pods)
4. Wire callback in each main list file's `createColumns` / `renderComponent`
5. Add to `*-bulk-actions.svelte` for bulk selection bar
6. Add to details sheet (`resource-details-sheet.svelte` or custom)
7. Run tests: `pnpm vitest run src/lib/widgets/datalists/`

### Adding a New Workload Page

1. Create directory under `$widgets/datalists/ui/{name}-list/`
2. Create `data-table.svelte` (use TanStack generic pattern from ReplicaSets)
3. Create `*-actions-menu.svelte` or use `ResourceActionsMenu` with `extraItems`
4. Create `*-bulk-actions.svelte` using `WorkloadBulkActions`
5. Create `*-selection-checkbox.svelte` using `ResourceSelectionCheckbox`
6. Create `model.ts` for row type and finder
7. Create `workbench-session.ts` for tab persistence
8. Wire into workload route registry
9. Add tests for actions menu, bulk actions, selection checkbox, data-table
