# Cluster Overview - Detail Page

Deep diagnostic view for a single cluster. Opens when you navigate into
a cluster from the fleet dashboard. Runs a **full** diagnostic pass that
includes checks the fleet cards skip for performance.

---

## Page Sections

### Control Plane Checks

Shows the status of core Kubernetes control plane components:

| Component              | How it's checked                                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API server**         | `/livez` + `/readyz` verbose endpoints                                                                                                             |
| **Kubelet**            | Metrics endpoint status from kubelet/cAdvisor check (`kubelet_cadvisor` key)                                                                       |
| **Scheduler**          | Pod fallback: looks for `kube-scheduler-*` pods in `kube-system`                                                                                   |
| **Controller Manager** | Pod fallback: looks for `kube-controller-manager-*` pods in `kube-system`                                                                          |
| **ETCD**               | Discovers etcd pods via labels (`component=etcd`, `k8s-app=etcd`, `app=etcd`), then runs `etcdctl endpoint health --cluster` and `endpoint status` |
| **APF**                | Parses `apiserver_flowcontrol_*` metrics from `/metrics` endpoint                                                                                  |

**Managed cluster detection:**

For managed K8s providers (EKS, GKE, AKS, DOKS, OKE, IKS, LKE, OVHcloud MKS, Scaleway Kapsule, Vultr VKE, Civo), scheduler/controller-manager/ETCD checks show "not_applicable" since the provider manages them. Detection uses node `spec.providerID` prefixes and cluster name/endpoint hint patterns. Hetzner Cloud (`hcloud://`) and Rancher are detected but marked as non-managed (self-managed control plane).

### Health Score (Runtime)

Composite score (0-100) based on real-time signals:

- API server latency and health
- Certificate expiration
- Pod issues (CrashLoopBackOff, pending, evicted)
- Admission webhook health
- Warning events
- APF queue saturation
- ETCD leader and endpoint health

### Cluster Score (Config)

Composite score (0-100) based on configuration risk:

- Resource requests/limits coverage
- BestEffort pod count
- HPA misconfiguration
- Probe coverage gaps
- Topology spread / PDB gaps
- PSA/PSS compliance
- SecurityContext hardening
- NetworkPolicy baseline
- Secrets in ConfigMaps
- PriorityClass coverage
- RBAC overprivilege
- Ingress TLS coverage

### Resource Insights

Workload-level overview: Pods, Deployments, StatefulSets, DaemonSets,
Jobs, CronJobs, Nodes - each with status and quantity.

---

## Fleet Cards vs Overview - Diagnostic Scope

| Check                                                                            | Fleet cards       | Overview page |
| -------------------------------------------------------------------------------- | ----------------- | ------------- |
| Workload counts (pods, deployments, nodes)                                       | Yes               | Yes           |
| Configuration checks (resources, probes, PDB, etc.)                              | Yes (diagnostics) | Yes           |
| API server health, latency                                                       | Yes (diagnostics) | Yes           |
| Pod issues, warning events                                                       | Yes (diagnostics) | Yes           |
| **Certificates health**                                                          | Deferred          | **Yes**       |
| **Admission webhooks**                                                           | Deferred          | **Yes**       |
| **ETCD health**                                                                  | Deferred          | **Yes**       |
| **APF (API Priority & Fairness)**                                                | Deferred          | **Yes**       |
| **Kubelet proxy healthz**                                                        | Deferred          | **Yes**       |
| **Metrics sources (kubelet, metrics-server, kube-state-metrics, node-exporter)** | Deferred          | **Yes**       |

Fleet cards use `dashboardHealthDiagnostics` mode which skips expensive
checks (certificates, admission webhooks, ETCD, APF, kubelet proxy,
full metrics probes) to keep the fleet page fast. The overview page uses
`"full"` mode via `resolveCollectionMode` when `isDashboardRootRouteActive()`
is false.

---

## Distribution-Specific Behavior

Control Plane Checks visibility depends on the Kubernetes distribution:

| Distribution           | Scheduler       | Controller Manager | ETCD            | Notes                                                            |
| ---------------------- | --------------- | ------------------ | --------------- | ---------------------------------------------------------------- |
| **kubeadm / minikube** | OK (static pod) | OK (static pod)    | OK (static pod) | Full visibility                                                  |
| **RKE1**               | Unavailable     | Unavailable        | Unavailable     | Control plane runs as Docker containers on host, not as K8s pods |
| **RKE2 / K3s**         | OK (static pod) | OK (static pod)    | OK (static pod) | Standard static pod naming                                       |
| **EKS / GKE / AKS**    | Not Applicable  | Not Applicable     | Not Applicable  | Provider-managed, not directly accessible                        |

For RKE1 clusters, API server health and latency are still checked via
the Kubernetes API - only pod-based component detection is limited.

---

## For Developers

### Architecture

```
overview.svelte                          - Main overview page
  buildControlPlaneChecks()              - Control plane panel logic
  buildOverviewResourceInsights()        - Resource insights
  buildOverviewTopRisks()                - Top risk items from cluster score

$widgets/datalists/ui/model/
  overview-insights.ts                   - Control plane + resource insight builders
  overview-diagnostics.ts                - Primary alert + health signal builders

$features/check-health/api/
  check-kubelet.ts                       - /proxy/healthz per node
  check-etcd-health.ts                   - etcdctl endpoint health/status
  check-apf-health.ts                    - APF metrics parser
  check-certificates-health.ts           - Certificate expiry checks
  check-admission-webhooks.ts            - Webhook configuration validation
  check-api-server-health.ts             - /livez + /readyz
  check-api-server-latency.ts            - /metrics apiserver_request_duration
```

### Data Flow

1. User navigates to cluster → overview page mounts
2. `getLastHealthCheck(clusterId)` loads cached data from store
3. If diagnostics data is missing (`!resourcesHygiene` or `!apiServerHealth`):
   - Auto-runs `updateClusterHealthChecks` with `diagnostics: true`
   - Chains config → health scopes sequentially
4. `resolveCollectionMode` returns `"full"` (not on dashboard root route)
5. Full mode runs all checks including certificates, ETCD, APF, kubelet
6. Results stored in `clusterHealthChecks` store and persisted to cache

### Adding a New Control Plane Check

1. Create checker in `$features/check-health/api/check-{name}.ts`
2. Wire into `collectClusterData` Promise.all block (guard with mode flags)
3. Add field to `ClusterHealthChecks` type
4. Add entry in `buildControlPlaneChecks()` in `overview-insights.ts`
5. Handle managed cluster case (deferred/not-applicable)
