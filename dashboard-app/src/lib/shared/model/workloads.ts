import type {
  CronJobs,
  DaemonSets,
  Deployments,
  Jobs,
  Nodes,
  Pods,
  ReplicaSets,
  StatefulSets,
} from "$shared/model/clusters";

export type WorkloadType =
  | "overview"
  | "globaltriage"
  | "pods"
  | "deployments"
  | "daemonsets"
  | "statefulsets"
  | "replicasets"
  | "replicationcontrollers"
  | "jobs"
  | "cronjobs"
  | "cronjobshealth"
  | "podsrestarts"
  | "deprecationscan"
  | "versionaudit"
  | "backupaudit"
  | "alertshub"
  | "armorhub"
  | "metricssources"
  | "compliancehub"
  | "trivyhub"
  | "helm"
  | "helmcatalog"
  | "nodesstatus"
  | "nodespressures"
  | "configmaps"
  | "namespaces"
  | "secrets"
  | "resourcequotas"
  | "limitranges"
  | "horizontalpodautoscalers"
  | "poddisruptionbudgets"
  | "priorityclasses"
  | "runtimeclasses"
  | "leases"
  | "mutatingwebhookconfigurations"
  | "validatingwebhookconfigurations"
  | "serviceaccounts"
  | "roles"
  | "rolebindings"
  | "clusterroles"
  | "clusterrolebindings"
  | "accessreviews"
  | "customresourcedefinitions"
  | "services"
  | "endpoints"
  | "endpointslices"
  | "ingresses"
  | "ingressclasses"
  | "gatewayclasses"
  | "gateways"
  | "httproutes"
  | "referencegrants"
  | "portforwarding"
  | "networkpolicies"
  | "persistentvolumeclaims"
  | "persistentvolumes"
  | "storageclasses"
  | "volumeattributesclasses"
  | "volumesnapshots"
  | "volumesnapshotcontents"
  | "volumesnapshotclasses"
  | "csistoragecapacities"
  | "rotatecerts"
  | "gitopsbootstrap"
  | "capacityintelligence"
  | "performanceobs"
  | "securityaudit"
  | "authsecurity"
  | "plugins"
  | "visualizer";

export type WorkloadData =
  | CronJobs
  | DaemonSets
  | Deployments
  | StatefulSets
  | ReplicaSets
  | Jobs
  | Pods
  | Nodes;

interface WorkloadQuantity {
  readonly quantity: number;
}

export type WorkloadsType =
  | "pods"
  | "daemonsets"
  | "deployments"
  | "statefulsets"
  | "replicasets"
  | "jobs"
  | "cronjobs"
  | "nodes";

export type WorkloadOverview = {
  [K in WorkloadsType]: WorkloadQuantity;
};
