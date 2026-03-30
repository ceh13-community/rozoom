# Observability - Alerts, Metrics, Pod Restarts, CronJobs, Node Pressures

Runtime observability signals: alert management, metrics pipeline
health, pod restart tracking, CronJob schedule monitoring, and node
pressure detection.

---

## Pages

### Cluster Alerts (687 lines)

Prometheus/Alertmanager integration:

- **Alert list**: firing, pending, resolved alerts with severity badges
- **Alert rules**: configured alert rules from Prometheus
- **Silences**: active silences with create/expire actions
- **Alertmanager detection**: checks if Alertmanager is reachable
- **Prometheus detection**: checks Prometheus API availability
- **Webhook configuration**: alert routing display
- Summary cards showing active alert counts by severity

### Metrics Sources Status (475 lines)

Observability pipeline health checker:

- **4 probe targets**: Kubelet, metrics-server, kube-state-metrics, node-exporter
- Per-source status: Available / Unavailable / Error
- Direct healthz endpoint checks via kubectl proxy
- In-app documentation link (`/docs/metrics-sources-hardening.md`)
- Summary cards with overall pipeline health

### Pod Restarts (68 lines)

Pod restart monitoring from cached health check data:

- Table with columns: Pod name, Namespace, Container, Restarts, Reason, Status
- Container-level restart reasons (CrashLoopBackOff, OOMKilled, etc.)
- Data sourced from `getLastHealthCheck` cache (no extra API calls)
- Manual refresh button

### CronJobs Monitoring (201 lines)

CronJob schedule health tracking:

- Table: Namespace, Name, Schedule, LastScheduleTime, Status, Reason
- **Problem filters**: toggle to show only problematic CronJobs
- **Search**: text filter across all fields
- Auto-refresh every 5 minutes with page visibility gating
- Status mapping: HEALTHY, MISSED, OVERDUE, SUSPENDED, etc.
- Data fetched via `loadClusterEntities` + `buildCronJobsHealth`

### Nodes Pressures (62 lines)

Node condition pressure monitoring:

- Table: Name, Role, Ready, DiskPressure, MemoryPressure, PIDPressure, NetworkUnavailable, Age
- Data from cached health check nodes data
- Manual refresh button
- Quick visibility into which nodes are under resource pressure

---

## Architecture

```
$widgets/cluster/ui/
  alerts-hub-panel.svelte               - Prometheus/Alertmanager (687 lines)
  metrics-sources-panel.svelte          - Pipeline health (475 lines)

$widgets/datalists/ui/
  pods-restarts/pods-restarts-list.svelte       - Pod restart table (68 lines)
  cronjobs-health/cronjobs-health-list.svelte   - CronJob health (201 lines)
  nodes-pressures/nodes-pressures-list.svelte   - Node pressures (62 lines)

$features/
  alerts-hub/model/store.ts             - Alert state, polling (590 lines)
  metrics-sources/model/store.ts        - Probe state, checks (555 lines)
```

### Tests

```bash
pnpm vitest run src/lib/features/alerts-hub/       # 5 tests
pnpm vitest run src/lib/features/metrics-sources/   # 6 tests
pnpm vitest run src/lib/widgets/datalists/ui/pods-restarts/       # 1 test
pnpm vitest run src/lib/widgets/datalists/ui/cronjobs-health/     # 1 test
```

Total: 13 tests.
