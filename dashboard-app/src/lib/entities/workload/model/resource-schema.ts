import type { WorkloadType } from "$shared/model/workloads";

export type ResourceDomain =
  | "workloads"
  | "configuration"
  | "access_control"
  | "custom_resources"
  | "network"
  | "storage";

export type ResourceCapability =
  | "namespaced"
  | "hasLogs"
  | "hasYamlEdit"
  | "hasScale"
  | "hasRestart"
  | "hasDataSection"
  | "hasEvents"
  | "supportsWatcher";

export type ResourceColumnId =
  | "name"
  | "namespace"
  | "status"
  | "age"
  | "cpu"
  | "memory"
  | "restarts"
  | "node"
  | "type"
  | "keys"
  | "labels"
  | "resourceVersion"
  | "value"
  | "globalDefault"
  | "handler"
  | "holder"
  | "webhooks"
  | "minAvailable"
  | "maxUnavailable"
  | "currentHealthy"
  | "desiredHealthy"
  | "metrics"
  | "minPods"
  | "maxPods"
  | "replicas"
  | "ports"
  | "claim"
  | "provisioner"
  | "reclaimPolicy"
  | "isDefaultStorageClass"
  | "bindings"
  | "resource"
  | "group"
  | "version"
  | "scope"
  | "kind"
  | "controller"
  | "apiGroup"
  | "externalIP"
  | "selector"
  | "endpoints"
  | "loadBalancers"
  | "policyTypes"
  | "storageClass"
  | "size"
  | "pods"
  | "capacity";

export type ResourceColumn = {
  id: ResourceColumnId;
  label: string;
  defaultVisible: boolean;
  sortable?: boolean;
};

export type ResourceSchema = {
  key: WorkloadType;
  domain: ResourceDomain;
  title: string;
  singularTitle: string;
  resourceName: string;
  capabilities: ReadonlySet<ResourceCapability>;
  defaultColumns: ResourceColumn[];
};

const NAMESPACED = "namespaced";
const HAS_LOGS = "hasLogs";
const HAS_YAML = "hasYamlEdit";
const HAS_SCALE = "hasScale";
const HAS_RESTART = "hasRestart";
const HAS_DATA = "hasDataSection";
const HAS_EVENTS = "hasEvents";
const WATCHER = "supportsWatcher";

function schema(
  input: Omit<ResourceSchema, "capabilities"> & { capabilities: ResourceCapability[] },
): ResourceSchema {
  return { ...input, capabilities: new Set(input.capabilities) };
}

function configurationDefaultColumns(key: string, namespaced: boolean): ResourceColumn[] {
  if (key === "priorityclasses") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "value", label: "Value", defaultVisible: true, sortable: true },
      { id: "globalDefault", label: "Global default", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
    ];
  }
  if (key === "namespaces") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "labels", label: "Labels", defaultVisible: true, sortable: true },
      { id: "status", label: "Status", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "secrets") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "namespace", label: "Namespace", defaultVisible: true, sortable: true },
      { id: "labels", label: "Labels", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "keys", label: "Keys", defaultVisible: true, sortable: true },
      { id: "type", label: "Type", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "resourcequotas" || key === "limitranges") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "namespace", label: "Namespace", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "poddisruptionbudgets") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "namespace", label: "Namespace", defaultVisible: true, sortable: true },
      { id: "minAvailable", label: "Min available", defaultVisible: true, sortable: true },
      { id: "maxUnavailable", label: "Max unavailable", defaultVisible: true, sortable: true },
      { id: "currentHealthy", label: "Current healthy", defaultVisible: true, sortable: true },
      { id: "desiredHealthy", label: "Desired healthy", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "runtimeclasses") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "handler", label: "Handler", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "leases") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "namespace", label: "Namespace", defaultVisible: true, sortable: true },
      { id: "holder", label: "Holder", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "mutatingwebhookconfigurations" || key === "validatingwebhookconfigurations") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "webhooks", label: "WebHooks", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "horizontalpodautoscalers") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "namespace", label: "Namespace", defaultVisible: true, sortable: true },
      { id: "metrics", label: "Metrics", defaultVisible: true, sortable: true },
      { id: "minPods", label: "Min Pods", defaultVisible: true, sortable: true },
      { id: "maxPods", label: "Max Pods", defaultVisible: true, sortable: true },
      { id: "replicas", label: "Replicas", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "status", label: "Status", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "rolebindings" || key === "clusterrolebindings") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "namespace", label: "Namespace", defaultVisible: namespaced, sortable: true },
      { id: "bindings", label: "Bindings", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "customresourcedefinitions") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "resource", label: "Resource", defaultVisible: true, sortable: true },
      { id: "group", label: "Group", defaultVisible: true, sortable: true },
      { id: "version", label: "Version", defaultVisible: true, sortable: true },
      { id: "scope", label: "Scope", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "services") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "namespace", label: "Namespace", defaultVisible: true, sortable: true },
      { id: "externalIP", label: "External IP", defaultVisible: true, sortable: true },
      { id: "selector", label: "Selector", defaultVisible: true, sortable: true },
      { id: "status", label: "Status", defaultVisible: true, sortable: true },
      { id: "ports", label: "Ports", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "endpoints") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "namespace", label: "Namespace", defaultVisible: true, sortable: true },
      { id: "endpoints", label: "Endpoints", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "endpointslices") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "namespace", label: "Namespace", defaultVisible: true, sortable: true },
      { id: "endpoints", label: "Endpoints", defaultVisible: true, sortable: true },
      { id: "ports", label: "Ports", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "ingresses") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "namespace", label: "Namespace", defaultVisible: true, sortable: true },
      { id: "loadBalancers", label: "LoadBalancers", defaultVisible: true, sortable: true },
      { id: "ports", label: "Rules", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "ingressclasses") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "namespace", label: "Namespace", defaultVisible: true, sortable: true },
      { id: "controller", label: "Controller", defaultVisible: true, sortable: true },
      { id: "apiGroup", label: "ApiGroup", defaultVisible: true, sortable: true },
      { id: "scope", label: "Scope", defaultVisible: true, sortable: true },
      { id: "kind", label: "Kind", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "networkpolicies") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "namespace", label: "Namespace", defaultVisible: true, sortable: true },
      { id: "policyTypes", label: "Policy Types", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "persistentvolumeclaims") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "namespace", label: "Namespace", defaultVisible: true, sortable: true },
      { id: "storageClass", label: "Storage Class", defaultVisible: true, sortable: true },
      { id: "size", label: "Size", defaultVisible: true, sortable: true },
      { id: "pods", label: "Pods", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "status", label: "Status", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "persistentvolumes") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "storageClass", label: "Storage Class", defaultVisible: true, sortable: true },
      { id: "capacity", label: "Capacity", defaultVisible: true, sortable: true },
      { id: "claim", label: "Claim", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "status", label: "Status", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "storageclasses") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "provisioner", label: "Provisioner", defaultVisible: true, sortable: true },
      { id: "reclaimPolicy", label: "Reclaim policy", defaultVisible: true, sortable: true },
      { id: "isDefaultStorageClass", label: "Default", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "volumeattributesclasses") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "provisioner", label: "Driver", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "volumesnapshots") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "namespace", label: "Namespace", defaultVisible: true, sortable: true },
      { id: "storageClass", label: "Snapshot Class", defaultVisible: true, sortable: true },
      { id: "size", label: "Restore Size", defaultVisible: true, sortable: true },
      { id: "status", label: "Status", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "volumesnapshotcontents") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "claim", label: "Snapshot Ref", defaultVisible: true, sortable: true },
      { id: "provisioner", label: "Driver", defaultVisible: true, sortable: true },
      { id: "reclaimPolicy", label: "Deletion Policy", defaultVisible: true, sortable: true },
      { id: "size", label: "Restore Size", defaultVisible: true, sortable: true },
      { id: "status", label: "Status", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "volumesnapshotclasses") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "provisioner", label: "Driver", defaultVisible: true, sortable: true },
      { id: "reclaimPolicy", label: "Deletion Policy", defaultVisible: true, sortable: true },
      { id: "isDefaultStorageClass", label: "Default", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  if (key === "csistoragecapacities") {
    return [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "namespace", label: "Namespace", defaultVisible: true, sortable: true },
      { id: "storageClass", label: "Storage Class", defaultVisible: true, sortable: true },
      { id: "capacity", label: "Capacity", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "resourceVersion", label: "RV", defaultVisible: false, sortable: true },
    ];
  }
  return [
    { id: "name", label: "Name", defaultVisible: true, sortable: true },
    { id: "namespace", label: "Namespace", defaultVisible: namespaced, sortable: true },
    { id: "age", label: "Age", defaultVisible: true, sortable: true },
    { id: "keys", label: "Keys", defaultVisible: key === "configmaps", sortable: true },
    { id: "type", label: "Type", defaultVisible: false, sortable: true },
    { id: "resourceVersion", label: "RV", defaultVisible: true, sortable: true },
  ];
}

const schemas: ResourceSchema[] = [
  schema({
    key: "nodesstatus",
    domain: "workloads",
    title: "Nodes status",
    singularTitle: "Node",
    resourceName: "nodes",
    capabilities: [HAS_YAML, HAS_EVENTS, WATCHER],
    defaultColumns: [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "status", label: "Status", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
      { id: "cpu", label: "CPU", defaultVisible: true, sortable: true },
      { id: "memory", label: "Memory", defaultVisible: true, sortable: true },
    ],
  }),
  schema({
    key: "pods",
    domain: "workloads",
    title: "Pods",
    singularTitle: "Pod",
    resourceName: "pods",
    capabilities: [NAMESPACED, HAS_LOGS, HAS_YAML, HAS_EVENTS, WATCHER],
    defaultColumns: [
      { id: "name", label: "Name", defaultVisible: true, sortable: true },
      { id: "namespace", label: "Namespace", defaultVisible: true, sortable: true },
      { id: "status", label: "Status", defaultVisible: true, sortable: true },
      { id: "restarts", label: "Restarts", defaultVisible: true, sortable: true },
      { id: "node", label: "Node", defaultVisible: true, sortable: true },
      { id: "age", label: "Age", defaultVisible: true, sortable: true },
    ],
  }),
  ...(
    ["deployments", "daemonsets", "statefulsets", "replicasets", "replicationcontrollers"] as const
  ).map((key) =>
    schema({
      key,
      domain: "workloads",
      title:
        key === "deployments"
          ? "Deployments"
          : key === "daemonsets"
            ? "Daemon Sets"
            : key === "statefulsets"
              ? "Stateful Sets"
              : key === "replicationcontrollers"
                ? "Replication Controllers"
                : "Replica Sets",
      singularTitle:
        key === "deployments"
          ? "Deployment"
          : key === "daemonsets"
            ? "DaemonSet"
            : key === "statefulsets"
              ? "StatefulSet"
              : key === "replicationcontrollers"
                ? "ReplicationController"
                : "ReplicaSet",
      resourceName: key,
      capabilities: [NAMESPACED, HAS_LOGS, HAS_YAML, HAS_EVENTS, HAS_RESTART, HAS_SCALE, WATCHER],
      defaultColumns: [
        { id: "name", label: "Name", defaultVisible: true, sortable: true },
        { id: "namespace", label: "Namespace", defaultVisible: true, sortable: true },
        { id: "status", label: "Status", defaultVisible: true, sortable: true },
        { id: "age", label: "Age", defaultVisible: true, sortable: true },
      ],
    }),
  ),
  ...(["jobs", "cronjobs"] as const).map((key) =>
    schema({
      key,
      domain: "workloads",
      title: key === "jobs" ? "Jobs" : "Cron Jobs",
      singularTitle: key === "jobs" ? "Job" : "CronJob",
      resourceName: key,
      capabilities: [NAMESPACED, HAS_LOGS, HAS_YAML, HAS_EVENTS, WATCHER],
      defaultColumns: [
        { id: "name", label: "Name", defaultVisible: true, sortable: true },
        { id: "namespace", label: "Namespace", defaultVisible: true, sortable: true },
        { id: "status", label: "Status", defaultVisible: true, sortable: true },
        { id: "age", label: "Age", defaultVisible: true, sortable: true },
      ],
    }),
  ),
  ...(
    [
      ["namespaces", "Namespaces", "Namespace", false],
      ["configmaps", "ConfigMaps", "ConfigMap", true],
      ["secrets", "Secrets", "Secret", true],
      ["resourcequotas", "Resource Quotas", "ResourceQuota", true],
      ["limitranges", "Limit Ranges", "LimitRange", true],
      ["horizontalpodautoscalers", "Horizontal Pod Autoscalers", "HorizontalPodAutoscaler", true],
      ["poddisruptionbudgets", "Pod Disruption Budgets", "PodDisruptionBudget", true],
      ["priorityclasses", "Priority Classes", "PriorityClass", false],
      ["runtimeclasses", "Runtime Classes", "RuntimeClass", false],
      ["leases", "Leases", "Lease", true],
      ["mutatingwebhookconfigurations", "Mutating Webhooks", "MutatingWebhookConfiguration", false],
      [
        "validatingwebhookconfigurations",
        "Validating Webhooks",
        "ValidatingWebhookConfiguration",
        false,
      ],
    ] as const
  ).map(([key, title, singularTitle, namespaced]) =>
    schema({
      key,
      domain: "configuration",
      title,
      singularTitle,
      resourceName: key,
      capabilities: [
        ...(namespaced ? ([NAMESPACED] as const) : []),
        HAS_YAML,
        HAS_EVENTS,
        WATCHER,
        ...(key === "configmaps" || key === "secrets" ? ([HAS_DATA] as const) : []),
      ],
      defaultColumns: configurationDefaultColumns(key, namespaced),
    }),
  ),
  ...(
    [
      ["serviceaccounts", "Service Accounts", "ServiceAccount", true],
      ["roles", "Roles", "Role", true],
      ["rolebindings", "Role Bindings", "RoleBinding", true],
      ["clusterroles", "Cluster Roles", "ClusterRole", false],
      ["clusterrolebindings", "Cluster Role Bindings", "ClusterRoleBinding", false],
    ] as const
  ).map(([key, title, singularTitle, namespaced]) =>
    schema({
      key,
      domain: "access_control",
      title,
      singularTitle,
      resourceName: key,
      capabilities: [...(namespaced ? ([NAMESPACED] as const) : []), HAS_YAML, HAS_EVENTS, WATCHER],
      defaultColumns:
        key === "rolebindings" || key === "clusterrolebindings"
          ? configurationDefaultColumns(key, namespaced)
          : [
              { id: "name", label: "Name", defaultVisible: true, sortable: true },
              { id: "namespace", label: "Namespace", defaultVisible: namespaced, sortable: true },
              { id: "age", label: "Age", defaultVisible: true, sortable: true },
              { id: "resourceVersion", label: "RV", defaultVisible: true, sortable: true },
            ],
    }),
  ),
  schema({
    key: "accessreviews",
    domain: "access_control",
    title: "Access Reviews",
    singularTitle: "Access Review",
    resourceName: "accessreviews",
    capabilities: [],
    defaultColumns: [
      { id: "namespace", label: "Namespace", defaultVisible: true, sortable: true },
      { id: "name", label: "Verb/Resource", defaultVisible: true, sortable: true },
      { id: "status", label: "Allowed", defaultVisible: true, sortable: true },
    ],
  }),
  schema({
    key: "customresourcedefinitions",
    domain: "custom_resources",
    title: "Custom Resource Definitions",
    singularTitle: "CustomResourceDefinition",
    resourceName: "customresourcedefinitions",
    capabilities: [HAS_YAML, HAS_EVENTS, WATCHER],
    defaultColumns: configurationDefaultColumns("customresourcedefinitions", false),
  }),
  ...(
    [
      ["services", "Services", "Service", true],
      ["endpoints", "Endpoints", "Endpoint", true],
      ["endpointslices", "EndpointSlices", "EndpointSlice", true],
      ["ingresses", "Ingresses", "Ingress", true],
      ["ingressclasses", "Ingress Classes", "IngressClass", false],
      ["gatewayclasses", "Gateway Classes", "GatewayClass", false],
      ["gateways", "Gateways", "Gateway", true],
      ["httproutes", "HTTP Routes", "HTTPRoute", true],
      ["referencegrants", "Reference Grants", "ReferenceGrant", true],
      ["networkpolicies", "Network Policies", "NetworkPolicy", true],
    ] as const
  ).map(([key, title, singularTitle, namespaced]) =>
    schema({
      key,
      domain: "network",
      title,
      singularTitle,
      resourceName: key,
      capabilities: [...(namespaced ? ([NAMESPACED] as const) : []), HAS_YAML, HAS_EVENTS, WATCHER],
      defaultColumns:
        key === "services" ||
        key === "endpoints" ||
        key === "endpointslices" ||
        key === "ingresses" ||
        key === "ingressclasses" ||
        key === "networkpolicies"
          ? configurationDefaultColumns(key, namespaced)
          : [
              { id: "name", label: "Name", defaultVisible: true, sortable: true },
              { id: "namespace", label: "Namespace", defaultVisible: namespaced, sortable: true },
              { id: "age", label: "Age", defaultVisible: true, sortable: true },
              { id: "resourceVersion", label: "RV", defaultVisible: true, sortable: true },
            ],
    }),
  ),
  schema({
    key: "portforwarding",
    domain: "network",
    title: "Port Forwarding",
    singularTitle: "Port Forward",
    resourceName: "portforwarding",
    capabilities: [],
    defaultColumns: [
      { id: "namespace", label: "Namespace", defaultVisible: true, sortable: true },
      { id: "name", label: "Resource", defaultVisible: true, sortable: true },
      { id: "type", label: "Local", defaultVisible: true, sortable: true },
      { id: "value", label: "Remote", defaultVisible: true, sortable: true },
    ],
  }),
  ...(
    [
      ["persistentvolumeclaims", "Persistent Volume Claims", "PersistentVolumeClaim", true],
      ["persistentvolumes", "Persistent Volumes", "PersistentVolume", false],
      ["storageclasses", "Storage Classes", "StorageClass", false],
      ["volumeattributesclasses", "Volume Attributes Classes", "VolumeAttributesClass", false],
      ["volumesnapshots", "Volume Snapshots", "VolumeSnapshot", true],
      ["volumesnapshotcontents", "Volume Snapshot Contents", "VolumeSnapshotContent", false],
      ["volumesnapshotclasses", "Volume Snapshot Classes", "VolumeSnapshotClass", false],
      ["csistoragecapacities", "CSI Storage Capacities", "CSIStorageCapacity", true],
    ] as const
  ).map(([key, title, singularTitle, namespaced]) =>
    schema({
      key,
      domain: "storage",
      title,
      singularTitle,
      resourceName: key,
      capabilities: [...(namespaced ? ([NAMESPACED] as const) : []), HAS_YAML, HAS_EVENTS, WATCHER],
      defaultColumns: configurationDefaultColumns(key, namespaced),
    }),
  ),
];

const schemaByKey = new Map<WorkloadType, ResourceSchema>(schemas.map((item) => [item.key, item]));

export function getResourceSchema(key: WorkloadType): ResourceSchema | null {
  return schemaByKey.get(key) ?? null;
}

export function getAllResourceSchemas(): ResourceSchema[] {
  return schemas.slice();
}

export function hasResourceCapability(key: WorkloadType, capability: ResourceCapability): boolean {
  const found = schemaByKey.get(key);
  if (!found) return false;
  return found.capabilities.has(capability);
}
