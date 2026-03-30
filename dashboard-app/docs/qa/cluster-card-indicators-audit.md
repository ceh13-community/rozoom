# Cluster Card Indicator Audit

Purpose:

- map every dashboard cluster-card indicator to its current implementation path
- anchor each indicator to an official source of truth
- document where the card intentionally shows cached or deferred state instead of a live probe

Scope:

- [`cluster-info-card.svelte`](src/lib/widgets/cluster/ui/cluster-info-card.svelte)
- top summary widgets rendered on dashboard cluster cards
- `Configuration check` and `Health checks` rows rendered on cluster cards

## Runtime Model

The current card pipeline intentionally has three layers:

1. `dashboard` refresh
   - lightweight steady-state path
   - uses cached summary plus fast workload refresh
2. `dashboardConfigDiagnostics`
   - config-oriented diagnostics rows
   - expected to be deferred/cached-first on cards
3. `dashboardHealthDiagnostics`
   - health-oriented diagnostics rows
   - expected to be deferred/cached-first on cards

This means a card indicator can be:

- `live`
- `cached-first`
- `explicit/manual`

That is intentional and should not be treated as drift by itself.

## Top Summary Widgets

| Indicator          | Current implementation                                                                                                                                                                 | Runtime mode           | Official source                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Deprecation scan` | [`deprecation-scan-summary.svelte`](src/lib/widgets/cluster/ui/deprecation-scan-summary.svelte), [`deprecation-scan/model/store.ts`](src/lib/features/deprecation-scan/model/store.ts) | cached-first / polling | Kubernetes Deprecated API Migration Guide: https://kubernetes.io/docs/reference/using-api/deprecation-guide/ |
| `K8s version`      | [`version-audit-summary.svelte`](src/lib/widgets/cluster/ui/version-audit-summary.svelte), version-audit store                                                                         | cached-first / polling | Kubernetes Version Skew Policy: https://kubernetes.io/releases/version-skew-policy                           |
| `Backup status`    | [`backup-audit-summary.svelte`](src/lib/widgets/cluster/ui/backup-audit-summary.svelte), [`backup-audit/model/store.ts`](src/lib/features/backup-audit/model/store.ts)                 | cached-first / polling | Velero Backup Reference: https://velero.io/docs/main/backup-reference/                                       |

## Workloads

| Indicator       | Current implementation                                                                                                                                   | Runtime mode                         | Official source                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `Deployments`   | [`deployments-count.svelte`](src/lib/widgets/cluster/ui/deployments-count.svelte)                                                                        | live/lightweight                     | Kubernetes Deployment concept: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/         |
| `Replica Sets`  | [`replicasets-count.svelte`](src/lib/widgets/cluster/ui/replicasets-count.svelte)                                                                        | live/lightweight                     | Kubernetes ReplicaSet concept: https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/         |
| `Stateful Sets` | [`statefulsets-count.svelte`](src/lib/widgets/cluster/ui/statefulsets-count.svelte)                                                                      | cached-first bootstrap, then summary | Kubernetes StatefulSet concept: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/       |
| `Daemon Sets`   | [`daemonsets-count.svelte`](src/lib/widgets/cluster/ui/daemonsets-count.svelte)                                                                          | cached-first bootstrap, then summary | Kubernetes DaemonSet concept: https://kubernetes.io/docs/concepts/workloads/controllers/daemonset/           |
| `Jobs`          | [`jobs-count.svelte`](src/lib/widgets/cluster/ui/jobs-count.svelte)                                                                                      | cached-first bootstrap, then summary | Kubernetes Job concept: https://kubernetes.io/docs/concepts/workloads/controllers/job/                       |
| `Cron Jobs`     | [`cronjobs-total.svelte`](src/lib/widgets/cluster/ui/cronjobs-total.svelte), [`cronjobs-count.svelte`](src/lib/widgets/cluster/ui/cronjobs-count.svelte) | cached-first bootstrap, then summary | Kubernetes CronJob concept: https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/             |
| `Pods`          | [`pods-count.svelte`](src/lib/widgets/cluster/ui/pods-count.svelte)                                                                                      | live/lightweight                     | Kubernetes Pods concept: https://kubernetes.io/docs/concepts/workloads/pods/                                 |
| `Nodes`         | [`nodes-count.svelte`](src/lib/widgets/cluster/ui/nodes-count.svelte), [`nodes-status.svelte`](src/lib/widgets/cluster/ui/nodes-status.svelte)           | cached-first / TTL reuse             | Kubernetes Nodes concept: https://kubernetes.io/docs/concepts/architecture/nodes/                            |
| `Namespaces`    | [`namespaces-list.svelte`](src/lib/widgets/cluster/ui/namespaces-list.svelte)                                                                            | cached-first bootstrap, then summary | Kubernetes Namespaces concept: https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/ |

## Security & Compliance

| Indicator        | Current implementation                                                                                                             | Runtime mode               | Official source                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------- |
| `KubeArmor`      | armor summary fallback in [`cluster-info-card.svelte`](src/lib/widgets/cluster/ui/cluster-info-card.svelte), armor store           | cached-first / linked page | KubeArmor docs: https://docs.kubearmor.io/                                        |
| `Compliance Hub` | compliance summary fallback in [`cluster-info-card.svelte`](src/lib/widgets/cluster/ui/cluster-info-card.svelte), compliance store | cached-first / linked page | Kubescape controls/frameworks: https://kubescape.io/docs/frameworks-and-controls/ |
| `Trivy`          | trivy summary fallback in [`cluster-info-card.svelte`](src/lib/widgets/cluster/ui/cluster-info-card.svelte), trivy store           | cached-first / linked page | Trivy Operator overview: https://aquasecurity.github.io/trivy-operator/v0.29.0/   |

## Observability

| Indicator         | Current implementation                                                                                                       | Runtime mode               | Official source                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------- |
| `Cluster Alerts`  | alert summary fallback in [`cluster-info-card.svelte`](src/lib/widgets/cluster/ui/cluster-info-card.svelte), alerts store    | cached-first / linked page | Prometheus Alerting overview: https://prometheus.io/docs/alerting/latest/overview/ |
| `Metrics Sources` | [`metrics-status.svelte`](src/lib/widgets/cluster/ui/metrics-status.svelte), metrics-sources store, `metricsChecks` fallback | cached-first / linked page | Metrics Server: https://github.com/kubernetes-sigs/metrics-server                  |

## Configuration Check

| Indicator            | Current implementation                                                                                                                                                          | Runtime mode                        | Official source                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Resources hygiene`  | [`resources-hygiene.svelte`](src/lib/widgets/cluster/ui/resources-hygiene.svelte), [`check-resources-hygiene.ts`](src/lib/features/check-health/api/check-resources-hygiene.ts) | deferred diagnostics / cached-first | Pod QoS and resource requests/limits: https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/                                                      |
| `HPA`                | [`hpa-status.svelte`](src/lib/widgets/cluster/ui/hpa-status.svelte), [`check-hpa.ts`](src/lib/features/check-health/api/check-hpa.ts)                                           | deferred diagnostics / cached-first | Horizontal Pod Autoscaling: https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/                                        |
| `Probes`             | [`probes-health.svelte`](src/lib/widgets/cluster/ui/probes-health.svelte), [`check-probes-health.ts`](src/lib/features/check-health/api/check-probes-health.ts)                 | deferred diagnostics / cached-first | Liveness, Readiness, and Startup Probes: https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/                          |
| `Pod QoS`            | [`pod-qos.svelte`](src/lib/widgets/cluster/ui/pod-qos.svelte)                                                                                                                   | deferred diagnostics / cached-first | Pod Quality of Service Classes: https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/                                                            |
| `VPA`                | [`vpa-status.svelte`](src/lib/widgets/cluster/ui/vpa-status.svelte), [`check-vpa-status.ts`](src/lib/features/check-health/api/check-vpa-status.ts)                             | deferred diagnostics / cached-first | Kubernetes Autoscaler repo, VPA: https://github.com/kubernetes/autoscaler                                                                              |
| `Topology / HA`      | [`topology-ha.svelte`](src/lib/widgets/cluster/ui/topology-ha.svelte), [`check-topology-ha.ts`](src/lib/features/check-health/api/check-topology-ha.ts)                         | deferred diagnostics / cached-first | Pod topology spread constraints: https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/                                  |
| `PDB`                | [`pdb-status.svelte`](src/lib/widgets/cluster/ui/pdb-status.svelte), [`check-pdb.ts`](src/lib/features/check-health/api/check-pdb.ts)                                           | deferred diagnostics / cached-first | Pod Disruptions / PDB: https://kubernetes.io/docs/concepts/workloads/pods/disruptions/                                                                 |
| `Priority`           | [`priority-status.svelte`](src/lib/widgets/cluster/ui/priority-status.svelte), [`check-priority.ts`](src/lib/features/check-health/api/check-priority.ts)                       | deferred diagnostics / cached-first | Pod Priority and Preemption: https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/                                          |
| `Pod Security`       | [`pod-security.svelte`](src/lib/widgets/cluster/ui/pod-security.svelte)                                                                                                         | deferred diagnostics / cached-first | Pod Security Standards: https://kubernetes.io/docs/concepts/security/pod-security-standards/                                                           |
| `Network isolation`  | [`network-isolation.svelte`](src/lib/widgets/cluster/ui/network-isolation.svelte)                                                                                               | deferred diagnostics / cached-first | Network Policies: https://kubernetes.io/docs/concepts/services-networking/network-policies/                                                            |
| `Secrets hygiene`    | [`secrets-hygiene.svelte`](src/lib/widgets/cluster/ui/secrets-hygiene.svelte)                                                                                                   | deferred diagnostics / cached-first | Kubernetes Secrets: https://kubernetes.io/docs/concepts/configuration/secret/ and Kubescape control C-0012: https://kubescape.io/docs/controls/c-0012/ |
| `Security hardening` | [`security-hardening.svelte`](src/lib/widgets/cluster/ui/security-hardening.svelte)                                                                                             | deferred diagnostics / cached-first | Pod Security Standards: https://kubernetes.io/docs/concepts/security/pod-security-standards/                                                           |

## Health Checks

| Indicator               | Current implementation                                                                                                                                                                  | Runtime mode                                   | Official source                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `API server live/ready` | [`api-server-health.svelte`](src/lib/widgets/cluster/ui/api-server-health.svelte)                                                                                                       | live or cached-first, depending on card mode   | Kubernetes API health endpoints: https://kubernetes.io/docs/reference/using-api/health-checks/                                  |
| `API server latency`    | [`api-server-latency.svelte`](src/lib/widgets/cluster/ui/api-server-latency.svelte)                                                                                                     | cached-first on cards                          | API server metrics and symptom-oriented alerting: https://prometheus.io/docs/practices/alerting/                                |
| `Certificates`          | [`certificates-health.svelte`](src/lib/widgets/cluster/ui/certificates-health.svelte), [`check-certificates-health.ts`](src/lib/features/check-health/api/check-certificates-health.ts) | explicit/manual on card, cached rows otherwise | kubeadm certificate management and kubelet rotation: https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-certs/ |
| `Pod issues`            | [`pod-issues.svelte`](src/lib/widgets/cluster/ui/pod-issues.svelte)                                                                                                                     | deferred diagnostics / cached-first            | Pod lifecycle and status: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/                                     |
| `Admission webhooks`    | [`admission-webhooks.svelte`](src/lib/widgets/cluster/ui/admission-webhooks.svelte)                                                                                                     | deferred diagnostics / cached-first            | Dynamic Admission Control: https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/            |
| `Warning events`        | [`warning-events.svelte`](src/lib/widgets/cluster/ui/warning-events.svelte)                                                                                                             | deferred diagnostics / cached-first            | Events concept: https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/event-v1/                                 |
| `Blackbox probes`       | [`blackbox-probes.svelte`](src/lib/widgets/cluster/ui/blackbox-probes.svelte)                                                                                                           | deferred diagnostics / cached-first            | Prometheus blackbox-exporter project semantics: https://prometheus.io/docs/guides/multi-target-exporter/                        |
| `APF`                   | [`apf-health.svelte`](src/lib/widgets/cluster/ui/apf-health.svelte)                                                                                                                     | cached-first on cards                          | API Priority and Fairness: https://kubernetes.io/docs/concepts/cluster-administration/flow-control/                             |
| `ETCD`                  | [`etcd-health.svelte`](src/lib/widgets/cluster/ui/etcd-health.svelte)                                                                                                                   | cached-first on cards                          | Operating etcd clusters for Kubernetes: https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/             |
| `Pod restarts`          | [`podrestarts-count.svelte`](src/lib/widgets/cluster/ui/podrestarts-count.svelte)                                                                                                       | live/cached-first summary                      | Pod lifecycle and restart policy: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/                             |
| `CronJobs health`       | [`cronjobs-count.svelte`](src/lib/widgets/cluster/ui/cronjobs-count.svelte)                                                                                                             | cached-first summary                           | Kubernetes CronJob concept: https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/                                |

## Current Alignment Notes

Aligned enough for dashboard-card semantics:

- `API server live/ready` uses the documented `livez` / `readyz` endpoints.
- `Pod QoS`, `Probes`, `PDB`, `Priority`, `Pod Security`, `Network isolation` are conceptually aligned with official Kubernetes semantics.
- `Metrics Sources` correctly treats `metrics-server` / `metrics.k8s.io` as autoscaling-oriented, not full observability.
- `Backup status`, `Deprecation scan`, `K8s version`, `Cluster Alerts`, `KubeArmor`, `Compliance`, `Trivy` are correctly modeled as linked-page summaries on the card, not full card-native diagnostics.

Intentional card-level deviations:

- Heavy probes are often `cached-first` or `manual` on cards.
- Card semantics are summary-oriented and not a replacement for the deeper workload page.
- For `Certificates`, `APF`, `ETCD`, and some observability probes, the card intentionally reuses prior snapshots instead of probing live on every refresh.

Indicators worth re-checking during future tuning:

- `API server latency`
  - card uses practical summary thresholds, not an official Kubernetes SLA
- `Blackbox probes`
  - semantics depend on exporter topology and project-specific installation
- `Cluster Alerts`
  - exact alert meanings depend on the installed Prometheus/Alertmanager ruleset
- `Backup status`
  - depends on Velero CRDs being installed; absence should be displayed explicitly, not as a generic failure

## Recommended Engineering Rule

For any future cluster-card indicator change:

1. identify the primary source of truth:
   - Kubernetes upstream docs
   - or official project docs for the backing tool
2. decide whether the card should be:
   - `live`
   - `cached-first`
   - `manual`
3. document any intentional approximation on the card
4. keep the linked workload page as the deeper source of detail when the card is summary-only
