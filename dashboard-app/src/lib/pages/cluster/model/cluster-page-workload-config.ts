import type { WorkloadType } from "$shared/model/workloads";

export const CLUSTER_HEALTH_WORKLOADS: WorkloadType[] = [
  "deprecationscan",
  "versionaudit",
  "backupaudit",
  "helm",
  "helmcatalog",
  "alertshub",
  "armorhub",
  "metricssources",
  "compliancehub",
  "trivyhub",
  "accessreviews",
  "portforwarding",
  "globaltriage",
  "podsrestarts",
  "cronjobshealth",
  "nodespressures",
  "rotatecerts",
  "gitopsbootstrap",
  "capacityintelligence",
  "performanceobs",
  "securityaudit",
  "authsecurity",
  "plugins",
  "visualizer",
  // @ts-expect-error not in WorkloadType yet
  "resourcemap",
];

export type WorkspaceWorkloadOption = {
  value: WorkloadType;
  label: string;
  group?: string;
};

export const WORKSPACE_WORKLOAD_OPTIONS: WorkspaceWorkloadOption[] = [
  // Cluster
  { value: "overview", label: "Overview", group: "Cluster" },
  { value: "nodesstatus", label: "Nodes", group: "Cluster" },
  { value: "nodespressures", label: "Node Pressure", group: "Cluster" },
  { value: "metricssources", label: "Metrics Sources", group: "Cluster" },
  { value: "helm", label: "Helm", group: "Cluster" },
  // Workloads
  { value: "pods", label: "Pods", group: "Workloads" },
  { value: "deployments", label: "Deployments", group: "Workloads" },
  { value: "daemonsets", label: "DaemonSets", group: "Workloads" },
  { value: "statefulsets", label: "StatefulSets", group: "Workloads" },
  { value: "replicasets", label: "ReplicaSets", group: "Workloads" },
  { value: "replicationcontrollers", label: "Replication Controllers", group: "Workloads" },
  { value: "jobs", label: "Jobs", group: "Workloads" },
  { value: "cronjobs", label: "CronJobs", group: "Workloads" },
  { value: "podsrestarts", label: "Pod Restarts", group: "Workloads" },
  { value: "cronjobshealth", label: "CronJobs Monitoring", group: "Workloads" },
  // Namespace
  { value: "namespaces", label: "Namespaces", group: "Namespace" },
  // Configuration
  { value: "configmaps", label: "ConfigMaps", group: "Configuration" },
  { value: "secrets", label: "Secrets", group: "Configuration" },
  { value: "resourcequotas", label: "Resource Quotas", group: "Configuration" },
  { value: "limitranges", label: "Limit Ranges", group: "Configuration" },
  { value: "horizontalpodautoscalers", label: "HPAs", group: "Configuration" },
  { value: "poddisruptionbudgets", label: "PDBs", group: "Configuration" },
  { value: "priorityclasses", label: "Priority Classes", group: "Configuration" },
  { value: "leases", label: "Leases", group: "Configuration" },
  { value: "mutatingwebhookconfigurations", label: "Mutating Webhooks", group: "Configuration" },
  {
    value: "validatingwebhookconfigurations",
    label: "Validating Webhooks",
    group: "Configuration",
  },
  // Access Control
  { value: "serviceaccounts", label: "Service Accounts", group: "Access Control" },
  { value: "roles", label: "Roles", group: "Access Control" },
  { value: "rolebindings", label: "Role Bindings", group: "Access Control" },
  { value: "clusterroles", label: "Cluster Roles", group: "Access Control" },
  { value: "clusterrolebindings", label: "Cluster Role Bindings", group: "Access Control" },
  // Custom Resources
  { value: "customresourcedefinitions", label: "CRDs", group: "Custom Resources" },
  // Network
  { value: "services", label: "Services", group: "Network" },
  { value: "ingresses", label: "Ingresses", group: "Network" },
  { value: "endpoints", label: "Endpoints", group: "Network" },
  { value: "networkpolicies", label: "Network Policies", group: "Network" },
  { value: "gateways", label: "Gateways", group: "Network" },
  { value: "httproutes", label: "HTTP Routes", group: "Network" },
  // Storage
  { value: "persistentvolumeclaims", label: "PVCs", group: "Storage" },
  { value: "persistentvolumes", label: "PVs", group: "Storage" },
  { value: "storageclasses", label: "Storage Classes", group: "Storage" },
  { value: "volumesnapshots", label: "Volume Snapshots", group: "Storage" },
];

export const WORKLOAD_LABEL_OVERRIDES: Record<string, string> = {
  nodesstatus: "Nodes",
  nodespressures: "Nodes Pressure",
  cronjobshealth: "CronJobs Monitoring",
  namespaces: "Namespaces",
  configmaps: "ConfigMaps",
  secrets: "Secrets",
  resourcequotas: "Resource Quotas",
  limitranges: "Limit Ranges",
  horizontalpodautoscalers: "Horizontal Pod Autoscalers",
  poddisruptionbudgets: "Pod Disruption Budgets",
  priorityclasses: "Priority Classes",
  runtimeclasses: "Runtime Classes",
  leases: "Leases",
  mutatingwebhookconfigurations: "Mutating Webhooks",
  validatingwebhookconfigurations: "Validating Webhooks",
  serviceaccounts: "Service Accounts",
  roles: "Roles",
  rolebindings: "Role Bindings",
  clusterroles: "Cluster Roles",
  clusterrolebindings: "Cluster Role Bindings",
  customresourcedefinitions: "Custom Resource Definitions",
  services: "Services",
  endpoints: "Endpoints",
  endpointslices: "EndpointSlices",
  ingresses: "Ingresses",
  ingressclasses: "Ingress Classes",
  podsrestarts: "Pod Restarts",
  replicationcontrollers: "Replication Controllers",
  metricssources: "Metrics Sources",
  globaltriage: "Global Triage",
  versionaudit: "Version Audit",
  deprecationscan: "Deprecation Scan",
  alertshub: "Alerts Hub",
  armorhub: "Armor Hub",
  backupaudit: "Backup Audit",
  helm: "Helm",
  helmcatalog: "Helm Catalog",
  trivyhub: "Trivy Hub",
  compliancehub: "Compliance Hub",
  accessreviews: "Access Reviews",
  portforwarding: "Port Forwarding",
  gatewayclasses: "Gateway Classes",
  gateways: "Gateways",
  httproutes: "HTTP Routes",
  referencegrants: "Reference Grants",
  networkpolicies: "Network Policies",
  persistentvolumeclaims: "Persistent Volume Claims",
  persistentvolumes: "Persistent Volumes",
  storageclasses: "Storage Classes",
  volumeattributesclasses: "Volume Attributes Classes",
  volumesnapshots: "Volume Snapshots",
  volumesnapshotcontents: "Volume Snapshot Contents",
  volumesnapshotclasses: "Volume Snapshot Classes",
  csistoragecapacities: "CSI Storage Capacities",
  rotatecerts: "Rotate Certificates",
  gitopsbootstrap: "GitOps Bootstrap",
  capacityintelligence: "Capacity Intelligence",
  performanceobs: "Performance",
  securityaudit: "Security Audit",
  authsecurity: "Auth & Credentials",
  plugins: "Plugins",
  visualizer: "Workload Map",
  resourcemap: "Resource Map",
};

export const CLUSTER_SWITCH_PREFETCH_WORKLOADS: WorkloadType[] = [
  "pods",
  "deployments",
  "daemonsets",
  "statefulsets",
  "replicasets",
  "replicationcontrollers",
  "jobs",
  "cronjobs",
  "nodesstatus",
  "namespaces",
];

export const namespaceScopedWorkloads = new Set<WorkloadType>([
  "pods",
  "deployments",
  "daemonsets",
  "statefulsets",
  "replicasets",
  "jobs",
  "cronjobs",
  "configmaps",
  "secrets",
  "resourcequotas",
  "limitranges",
  "horizontalpodautoscalers",
  "poddisruptionbudgets",
  "leases",
  "gateways",
  "httproutes",
  "referencegrants",
  "serviceaccounts",
  "roles",
  "rolebindings",
  "services",
  "endpoints",
  "endpointslices",
  "ingresses",
  "networkpolicies",
  "persistentvolumeclaims",
  "volumesnapshots",
  "csistoragecapacities",
]);

export const configurationWorkloads = new Set<WorkloadType>([
  "replicationcontrollers",
  "configmaps",
  "secrets",
  "resourcequotas",
  "limitranges",
  "horizontalpodautoscalers",
  "poddisruptionbudgets",
  "priorityclasses",
  "runtimeclasses",
  "leases",
  "mutatingwebhookconfigurations",
  "validatingwebhookconfigurations",
  "serviceaccounts",
  "roles",
  "rolebindings",
  "clusterroles",
  "clusterrolebindings",
  "customresourcedefinitions",
  "services",
  "endpoints",
  "endpointslices",
  "ingresses",
  "ingressclasses",
  "gatewayclasses",
  "gateways",
  "httproutes",
  "referencegrants",
  "networkpolicies",
  "persistentvolumeclaims",
  "persistentvolumes",
  "storageclasses",
  "volumeattributesclasses",
  "volumesnapshots",
  "volumesnapshotcontents",
  "volumesnapshotclasses",
  "csistoragecapacities",
]);

export function getWorkloadOptionGroups(): Array<{
  group: string;
  options: WorkspaceWorkloadOption[];
}> {
  const groups = new Map<string, WorkspaceWorkloadOption[]>();
  for (const option of WORKSPACE_WORKLOAD_OPTIONS) {
    const group = option.group ?? "";
    if (!groups.has(group)) groups.set(group, []);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    groups.get(group)!.push(option);
  }
  return [...groups.entries()].map(([group, options]) => ({ group, options }));
}

export function toWorkloadLabel(workload: WorkloadType): string {
  if (workload in WORKLOAD_LABEL_OVERRIDES) {
    return WORKLOAD_LABEL_OVERRIDES[workload];
  }
  return workload
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function toPinnedWorkloadType(workload: string): WorkloadType {
  const match = WORKSPACE_WORKLOAD_OPTIONS.find((item) => item.value === workload);
  return match ? match.value : "overview";
}

export function hasRenderableWorkloadData(workload: WorkloadType, workloadData: unknown): boolean {
  if (CLUSTER_HEALTH_WORKLOADS.includes(workload) || workload === "pods") return true;
  if (Array.isArray(workloadData)) return workloadData.length > 0;
  return (
    Boolean(workloadData) &&
    typeof workloadData === "object" &&
    workloadData !== null &&
    Object.keys(workloadData).length > 0
  );
}
