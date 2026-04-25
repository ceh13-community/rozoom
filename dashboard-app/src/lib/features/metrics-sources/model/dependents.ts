export interface Dependent {
  title: string;
  description: string;
  testCommand?: string;
  alertNames?: string[];
}

export interface SourceDependents {
  sourceId: string;
  sourceTitle: string;
  summary: string;
  dependents: Dependent[];
}

export const SOURCE_DEPENDENTS: SourceDependents[] = [
  {
    sourceId: "metrics-server",
    sourceTitle: "metrics-server",
    summary:
      "metrics-server serves the resource-metrics API (`metrics.k8s.io/v1beta1`). It is consumed only by in-cluster Kubernetes controllers and kubectl, not by Prometheus.",
    dependents: [
      {
        title: "kubectl top nodes / pods",
        description: "The CLI fails with 'Metrics API not available' if metrics-server is down.",
        testCommand: "kubectl top nodes",
      },
      {
        title: "HorizontalPodAutoscaler (HPA)",
        description:
          "HPA reads CPU / memory targets from metrics.k8s.io. Without it, HPA shows `<unknown>` and will not scale.",
        testCommand: "kubectl get hpa -A",
      },
      {
        title: "VerticalPodAutoscaler recommendations (VPA)",
        description:
          "VPA recommender uses metrics-server plus history. First-run recommendations require live metrics.",
      },
      {
        title: "Scheduler Extender / Descheduler",
        description:
          "Some schedulers use live usage via metrics.k8s.io for load-aware placement and eviction decisions.",
      },
    ],
  },
  {
    sourceId: "kube-state-metrics",
    sourceTitle: "kube-state-metrics",
    summary:
      "kube-state-metrics (KSM) exposes the object state of every Kubernetes resource as Prometheus metrics. It is the backbone of every Kubernetes dashboard and most alert rules.",
    dependents: [
      {
        title: "Grafana Kubernetes dashboards",
        description:
          "Pod, Deployment, Namespace, ReplicaSet, Job panels all query `kube_*` metrics. Dashboards go blank without KSM.",
        testCommand: "curl -s http://kube-state-metrics.monitoring.svc:8080/metrics | head -20",
      },
      {
        title: "kube-prometheus-stack alert rules",
        description:
          "Most alertnames (KubeDeploymentReplicasMismatch, KubePodCrashLooping, KubeJobFailed, etc.) read KSM metrics.",
        alertNames: [
          "KubeDeploymentReplicasMismatch",
          "KubePodCrashLooping",
          "KubeJobFailed",
          "KubeStatefulSetReplicasMismatch",
          "KubeContainerWaiting",
        ],
      },
      {
        title: "Capacity / cost analysis",
        description:
          "Tools like kubecost and ROZOOM Capacity Intelligence join KSM labels with node/container usage to attribute cost.",
      },
    ],
  },
  {
    sourceId: "node-exporter",
    sourceTitle: "node-exporter",
    summary:
      "node-exporter (DaemonSet on every node, hostNetwork, port 9100) exposes host-level metrics: CPU, memory, filesystem, network, systemd units, hardware.",
    dependents: [
      {
        title: "Grafana Node dashboards",
        description: "`Node Exporter / Nodes` and USE/RED panels query node_* metrics.",
        testCommand: "curl -s http://<node-ip>:9100/metrics | head -20",
      },
      {
        title: "Node-level alert rules (kubernetes-mixin)",
        description: "DiskPressure, memory pressure, filesystem fill-up, high conntrack, etc.",
        alertNames: [
          "NodeFilesystemAlmostOutOfSpace",
          "NodeFilesystemSpaceFillingUp",
          "NodeHighNumberConntrack",
          "NodeNetworkReceiveErrs",
          "NodeClockSkewDetected",
        ],
      },
      {
        title: "Per-node capacity planning",
        description:
          "Decisions about scaling up/down, replacing instance types, and disk growth rely on node-exporter history.",
      },
    ],
  },
  {
    sourceId: "kubelet-cadvisor",
    sourceTitle: "Kubelet / cAdvisor",
    summary:
      "cAdvisor is embedded in every kubelet. It exposes `container_*` metrics on `/metrics/cadvisor` per node - CPU, memory, network, filesystem usage per container.",
    dependents: [
      {
        title: "Prometheus container-level queries",
        description:
          "`container_memory_working_set_bytes`, `container_cpu_usage_seconds_total` come from here.",
      },
      {
        title: "Pod resource accounting",
        description:
          "Tools displaying per-container CPU/memory charts (Grafana, k9s, Lens) pull from this endpoint.",
      },
      {
        title: "OOM and throttling detection",
        description:
          "`container_oom_events_total` and `container_cpu_cfs_throttled_periods_total` alerts.",
        alertNames: ["KubeContainerOomKilled", "ContainerHighCpuThrottling"],
      },
    ],
  },
];

export function getDependentsFor(sourceId: string): SourceDependents | null {
  return SOURCE_DEPENDENTS.find((d) => d.sourceId === sourceId) ?? null;
}
