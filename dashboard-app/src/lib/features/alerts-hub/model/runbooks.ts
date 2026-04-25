// Best-effort built-in runbook links for common alertnames emitted by
// kube-prometheus-stack / kubernetes-mixin. Used when the alert itself has no
// `runbook_url` annotation.

const BUILTIN_RUNBOOKS: Record<string, string> = {
  // kubelet / node
  KubeNodeNotReady: "https://runbooks.prometheus-operator.dev/runbooks/kubernetes/kubenodenotready",
  KubeNodeUnreachable:
    "https://runbooks.prometheus-operator.dev/runbooks/kubernetes/kubenodeunreachable",
  KubeletTooManyPods:
    "https://runbooks.prometheus-operator.dev/runbooks/kubernetes/kubelettoomanypods",
  NodeFilesystemAlmostOutOfSpace:
    "https://runbooks.prometheus-operator.dev/runbooks/node/nodefilesystemalmostoutofspace",
  NodeFilesystemSpaceFillingUp:
    "https://runbooks.prometheus-operator.dev/runbooks/node/nodefilesystemspacefillingup",
  NodeHighNumberConntrack:
    "https://runbooks.prometheus-operator.dev/runbooks/node/nodehighnumberconntrack",

  // API server
  KubeAPIDown: "https://runbooks.prometheus-operator.dev/runbooks/kubernetes/kubeapidown",
  KubeAPIErrorBudgetBurn:
    "https://runbooks.prometheus-operator.dev/runbooks/kubernetes/kubeapierrorbudgetburn",
  KubeClientErrors: "https://runbooks.prometheus-operator.dev/runbooks/kubernetes/kubeclienterrors",

  // etcd
  etcdInsufficientMembers: "https://etcd.io/docs/latest/op-guide/recovery/",
  etcdNoLeader: "https://etcd.io/docs/latest/op-guide/recovery/",
  etcdHighNumberOfLeaderChanges:
    "https://etcd.io/docs/latest/op-guide/monitoring/#leadership-change-counter",

  // workloads
  KubePodCrashLooping:
    "https://runbooks.prometheus-operator.dev/runbooks/kubernetes/kubepodcrashlooping",
  KubePodNotReady: "https://runbooks.prometheus-operator.dev/runbooks/kubernetes/kubepodnotready",
  KubeDeploymentReplicasMismatch:
    "https://runbooks.prometheus-operator.dev/runbooks/kubernetes/kubedeploymentreplicasmismatch",
  KubeStatefulSetReplicasMismatch:
    "https://runbooks.prometheus-operator.dev/runbooks/kubernetes/kubestatefulsetreplicasmismatch",
  KubeJobFailed: "https://runbooks.prometheus-operator.dev/runbooks/kubernetes/kubejobfailed",
  KubeContainerWaiting:
    "https://runbooks.prometheus-operator.dev/runbooks/kubernetes/kubecontainerwaiting",

  // memory / CPU
  KubeMemoryOvercommit:
    "https://runbooks.prometheus-operator.dev/runbooks/kubernetes/kubememoryovercommit",
  KubeCPUOvercommit:
    "https://runbooks.prometheus-operator.dev/runbooks/kubernetes/kubecpuovercommit",

  // certificates
  KubeClientCertificateExpiration:
    "https://runbooks.prometheus-operator.dev/runbooks/kubernetes/kubeclientcertificateexpiration",
  CertManagerCertExpirySoon: "https://cert-manager.io/docs/troubleshooting/",

  // prometheus operator itself
  AlertmanagerFailedReload:
    "https://runbooks.prometheus-operator.dev/runbooks/alertmanager/alertmanagerfailedreload",
  AlertmanagerConfigInconsistent:
    "https://runbooks.prometheus-operator.dev/runbooks/alertmanager/alertmanagerconfiginconsistent",
  AlertmanagerClusterDown:
    "https://runbooks.prometheus-operator.dev/runbooks/alertmanager/alertmanagerclusterdown",
  PrometheusRuleFailures:
    "https://runbooks.prometheus-operator.dev/runbooks/prometheus/prometheusrulefailures",
  PrometheusNotIngestingSamples:
    "https://runbooks.prometheus-operator.dev/runbooks/prometheus/prometheusnotingestingsamples",
  PrometheusTargetLimitHit:
    "https://runbooks.prometheus-operator.dev/runbooks/prometheus/prometheustargetlimithit",
};

export function lookupRunbook(alertname: string): string | null {
  return BUILTIN_RUNBOOKS[alertname] ?? null;
}
