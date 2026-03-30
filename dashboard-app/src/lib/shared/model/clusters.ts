export interface OwnerReference {
  kind: string;
  name: string;
}

export interface MetaData {
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
  ownerReferences?: OwnerReference[];
}

export interface BaseItem {
  metadata: MetaData;
}

export interface BaseClusterData<T extends BaseItem> {
  items: T[];
}
export interface ClusterItemsData extends BaseClusterData<BaseItem> {
  items: BaseItem[];
}

export interface ProbeHandlerHttpGet {
  path?: string;
  port?: number | string;
  scheme?: string;
}

export interface ProbeHandlerTcpSocket {
  port?: number | string;
}

export interface ProbeHandlerExec {
  command?: string[];
}

export interface ContainerProbe {
  initialDelaySeconds?: number;
  timeoutSeconds?: number;
  periodSeconds?: number;
  failureThreshold?: number;
  successThreshold?: number;
  httpGet?: ProbeHandlerHttpGet;
  tcpSocket?: ProbeHandlerTcpSocket;
  exec?: ProbeHandlerExec;
}

export interface TopologySpreadConstraint {
  maxSkew?: number;
  topologyKey?: string;
  whenUnsatisfiable?: string;
}

export interface PodAntiAffinity {
  requiredDuringSchedulingIgnoredDuringExecution?: unknown[];
  preferredDuringSchedulingIgnoredDuringExecution?: unknown[];
}

export interface PodAffinity {
  podAntiAffinity?: PodAntiAffinity;
}

// Nodes
export interface NodeSpec {
  configSource: {
    configMap: {
      kubeletConfigKey: string;
      name: string;
      namespace: string;
      resourceVersion: string;
      uid: string;
    };
  };
  externalID: string;
  podCIDR: string;
  podCIDRs: string[];
  providerID: string;
  taints: {
    key: string;
    value: string;
    effect: string;
  }[];
  unschedulable: boolean;
}
export interface NodeStatus {
  allocatable?: {
    cpu: string;
    memory: string;
    "ephemeral-storage": string;
  };
  capacity?: {
    cpu: string;
    memory: string;
    "ephemeral-storage": string;
  };
  conditions?: {
    lastHeartbeatTime: string;
    lastTransitionTime: string;
    message: string;
    reason: string;
    status: string;
    type: string;
  }[];
  nodeInfo?: {
    kubeletVersion: string;
  };
}

export interface NodeMetadata {
  creationTimestamp: string;
  name: string;
  namespace: string;
  uid?: string;
  labels?: Record<string, string>;
}

export interface NodeItem extends BaseItem {
  metadata: NodeMetadata;
  spec: NodeSpec;
  status: NodeStatus;
}

export type Nodes = BaseClusterData<NodeItem>;

// Pods
export interface PodSpec {
  containers: {
    name: string;
    image: string;
    resources?: {
      limits?: {
        cpu?: string;
        memory?: string;
      };
      requests?: {
        cpu?: string;
        memory?: string;
      };
    };
    livenessProbe?: ContainerProbe;
    readinessProbe?: ContainerProbe;
    startupProbe?: ContainerProbe;
    securityContext?: {
      runAsNonRoot?: boolean;
      runAsUser?: number;
      allowPrivilegeEscalation?: boolean;
      readOnlyRootFilesystem?: boolean;
      privileged?: boolean;
      seccompProfile?: {
        type?: string;
        localhostProfile?: string;
      };
      capabilities?: {
        drop?: string[];
        add?: string[];
      };
    };
  }[];
  securityContext?: {
    runAsNonRoot?: boolean;
    runAsUser?: number;
    seccompProfile?: {
      type?: string;
      localhostProfile?: string;
    };
  };
  priorityClassName?: string;
  preemptionPolicy?: string;
  hostNetwork?: boolean;
  hostPID?: boolean;
  hostIPC?: boolean;
  nodeName: string;
  volumes?: {
    name: string;
    hostPath?: {
      path?: string;
    };
  }[];
}

export interface PodMetadata {
  creationTimestamp?: string;
  deletionTimestamp?: string;
  name: string;
  namespace: string;
  labels?: Record<string, string>;
  ownerReferences?: OwnerReference[];
  uid?: string;
}

export interface ContainerStatusState {
  running?: {
    startedAt: string;
  };
  terminated?: {
    exitCode: number;
    message: string;
    reason: string;
  };
  waiting?: {
    message: string;
    reason: string;
  };
}

export interface ContainerStatus {
  lastState?: ContainerStatusState;
  name: string;
  ready: boolean;
  restartCount: number;
  state: ContainerStatusState;
}

export interface PodStatus {
  initContainerStatuses?: ContainerStatus[];
  phase: string;
  startTime?: Date;
  qosClass?: string;
  containerStatuses?: ContainerStatus[];
}

export interface PodItem extends BaseItem {
  metadata: PodMetadata;
  spec: PodSpec;
  status: PodStatus;
}

export type Pods = BaseClusterData<PodItem>;

// Deployments
export interface DeploymentSpec {
  replicas: number;
  selector: {
    matchLabels: {
      [key: string]: string;
    };
  };
  template: {
    metadata: {
      labels: {
        [key: string]: string;
      };
    };
    spec: {
      containers: {
        name: string;
        image: string;
        resources?: {
          limits?: {
            cpu?: string;
            memory?: string;
          };
          requests?: {
            cpu?: string;
            memory?: string;
          };
        };
        livenessProbe?: ContainerProbe;
        readinessProbe?: ContainerProbe;
        startupProbe?: ContainerProbe;
        securityContext?: {
          runAsNonRoot?: boolean;
          runAsUser?: number;
          allowPrivilegeEscalation?: boolean;
          readOnlyRootFilesystem?: boolean;
          privileged?: boolean;
          seccompProfile?: {
            type?: string;
            localhostProfile?: string;
          };
          capabilities?: {
            drop?: string[];
            add?: string[];
          };
        };
      }[];
      securityContext?: {
        runAsNonRoot?: boolean;
        runAsUser?: number;
        seccompProfile?: {
          type?: string;
          localhostProfile?: string;
        };
      };
      priorityClassName?: string;
      preemptionPolicy?: string;
      hostNetwork?: boolean;
      hostPID?: boolean;
      hostIPC?: boolean;
      topologySpreadConstraints?: TopologySpreadConstraint[];
      affinity?: PodAffinity;
    };
  };
}

export interface DeploymentStatus {
  conditions?: {
    reason: string;
    type: string;
    status: string;
    lastProbeTime?: Date;
    lastTransitionTime?: Date;
  }[];
  replicas: number;
  readyReplicas: number;
  availableReplicas: number;
  phase?: string;
}

export interface DeploymentMetadata extends MetaData {
  creationTimestamp: Date;
  annotations?: Record<string, string>;
  labels?: Record<string, string>;
}

export interface DeploymentItem extends BaseItem {
  metadata: DeploymentMetadata;
  spec: DeploymentSpec;
  status: DeploymentStatus;
}

export type Deployments = BaseClusterData<DeploymentItem>;

// StatefulSets
export interface StatefulSetSpec {
  replicas: number;
  selector: {
    matchLabels: {
      [key: string]: string;
    };
  };
  template: {
    metadata: {
      labels: {
        [key: string]: string;
      };
    };
    spec: {
      containers: {
        name: string;
        image: string;
        resources?: {
          limits?: {
            cpu?: string;
            memory?: string;
          };
          requests?: {
            cpu?: string;
            memory?: string;
          };
        };
        livenessProbe?: ContainerProbe;
        readinessProbe?: ContainerProbe;
        startupProbe?: ContainerProbe;
        securityContext?: {
          runAsNonRoot?: boolean;
          runAsUser?: number;
          allowPrivilegeEscalation?: boolean;
          readOnlyRootFilesystem?: boolean;
          privileged?: boolean;
          seccompProfile?: {
            type?: string;
            localhostProfile?: string;
          };
          capabilities?: {
            drop?: string[];
            add?: string[];
          };
        };
      }[];
      securityContext?: {
        runAsNonRoot?: boolean;
        runAsUser?: number;
        seccompProfile?: {
          type?: string;
          localhostProfile?: string;
        };
      };
      priorityClassName?: string;
      preemptionPolicy?: string;
      hostNetwork?: boolean;
      hostPID?: boolean;
      hostIPC?: boolean;
      topologySpreadConstraints?: TopologySpreadConstraint[];
      affinity?: PodAffinity;
    };
  };
}

export interface StatefulSetMetadata extends MetaData {
  creationTimestamp: Date;
}

export interface StatefulSetStatus {
  replicas?: number;
  readyReplicas?: number;
  updatedReplicas?: number;
  availableReplicas?: number;
}

export interface StatefulSetItem extends BaseItem {
  metadata: StatefulSetMetadata;
  spec: StatefulSetSpec;
  status: StatefulSetStatus;
}

export type StatefulSets = BaseClusterData<StatefulSetItem>;

// ReplicaSets
export interface ReplicaSetMetadata extends MetaData {
  creationTimestamp: Date;
  annotations?: Record<string, string>;
}

export interface ReplicaSetSpec {
  replicas: number;
  selector: {
    matchLabels: {
      [key: string]: string;
    };
  };
  template: {
    metadata: {
      labels: {
        [key: string]: string;
      };
    };
    spec: {
      containers: {
        name: string;
        image: string;
        resources?: {
          limits?: {
            cpu?: string;
            memory?: string;
          };
          requests?: {
            cpu?: string;
            memory?: string;
          };
        };
        livenessProbe?: ContainerProbe;
        readinessProbe?: ContainerProbe;
        startupProbe?: ContainerProbe;
      }[];
    };
  };
}

export interface ReplicaSetStatus {
  replicas: number;
  readyReplicas: number;
  availableReplicas: number;
}

export interface ReplicaSetItem extends BaseItem {
  metadata: ReplicaSetMetadata;
  spec: ReplicaSetSpec;
  status: ReplicaSetStatus;
}

export type ReplicaSets = BaseClusterData<ReplicaSetItem>;

// Jobs
export interface JobMetadata extends MetaData {
  creationTimestamp: Date;
}

export interface JobSpec {
  completions?: number;
  parallelism?: number;
  backoffLimit?: number;
  template?: {
    spec?: {
      containers?: {
        name: string;
        image?: string;
        resources?: {
          limits?: {
            cpu?: string;
            memory?: string;
          };
          requests?: {
            cpu?: string;
            memory?: string;
          };
        };
        livenessProbe?: ContainerProbe;
        readinessProbe?: ContainerProbe;
        startupProbe?: ContainerProbe;
        securityContext?: {
          runAsNonRoot?: boolean;
          runAsUser?: number;
          allowPrivilegeEscalation?: boolean;
          readOnlyRootFilesystem?: boolean;
          privileged?: boolean;
          seccompProfile?: {
            type?: string;
            localhostProfile?: string;
          };
          capabilities?: {
            drop?: string[];
            add?: string[];
          };
        };
      }[];
      securityContext?: {
        runAsNonRoot?: boolean;
        runAsUser?: number;
        seccompProfile?: {
          type?: string;
          localhostProfile?: string;
        };
      };
      hostNetwork?: boolean;
      hostPID?: boolean;
      hostIPC?: boolean;
    };
  };
}

export interface JobStatus {
  conditions?: {
    type: string;
    status: string;
    lastProbeTime?: Date;
    lastTransitionTime?: Date;
  }[];
  completionTime?: Date;
  startTime?: Date;
  ready?: number;
  succeeded?: number;
  failed?: number;
  active?: number;
}

export interface JobItem extends BaseItem {
  metadata: JobMetadata;
  spec: JobSpec;
  status: JobStatus;
}

export type Jobs = BaseClusterData<JobItem>;

// CronJobs
export interface CronJobMetadata extends MetaData {
  creationTimestamp: Date;
}

export interface CronJobSpec {
  schedule?: string;
  suspend?: boolean;
  concurrencyPolicy?: string;
  failedJobsHistoryLimit?: number;
  successfulJobsHistoryLimit?: number;
  jobTemplate?: {
    metadata?: Record<string, unknown>;
    spec?: {
      template?: {
        spec?: {
          containers?: {
            name: string;
            image?: string;
            resources?: {
              limits?: {
                cpu?: string;
                memory?: string;
              };
              requests?: {
                cpu?: string;
                memory?: string;
              };
            };
            livenessProbe?: ContainerProbe;
            readinessProbe?: ContainerProbe;
            startupProbe?: ContainerProbe;
            securityContext?: {
              runAsNonRoot?: boolean;
              runAsUser?: number;
              allowPrivilegeEscalation?: boolean;
              readOnlyRootFilesystem?: boolean;
              privileged?: boolean;
              seccompProfile?: {
                type?: string;
                localhostProfile?: string;
              };
              capabilities?: {
                drop?: string[];
                add?: string[];
              };
            };
          }[];
          securityContext?: {
            runAsNonRoot?: boolean;
            runAsUser?: number;
            seccompProfile?: {
              type?: string;
              localhostProfile?: string;
            };
          };
          hostNetwork?: boolean;
          hostPID?: boolean;
          hostIPC?: boolean;
        };
      };
    };
  };
}

export interface CronJobStatus {
  lastScheduleTime?: Date;
  active?: { name: string }[];
  lastSuccessfulTime?: Date;
}

export interface CronJobItem extends BaseItem {
  metadata: CronJobMetadata;
  spec: CronJobSpec;
  status: CronJobStatus;
}

export type CronJobs = BaseClusterData<CronJobItem>;

// ConfigMaps
export interface ConfigMapItem extends BaseItem {
  metadata: MetaData;
  data?: Record<string, string>;
  binaryData?: Record<string, string>;
}

export type ConfigMaps = BaseClusterData<ConfigMapItem>;

// Secrets
export interface SecretItem extends BaseItem {
  metadata: MetaData;
  type?: string;
  data?: Record<string, string>;
}

export type Secrets = BaseClusterData<SecretItem>;

// PodDisruptionBudgets
export interface PodDisruptionBudgetSpec {
  minAvailable?: number | string;
  maxUnavailable?: number | string;
  selector?: {
    matchLabels?: Record<string, string>;
  };
}

export interface PodDisruptionBudgetStatus {
  disruptionsAllowed?: number;
  currentHealthy?: number;
  desiredHealthy?: number;
  expectedPods?: number;
}

export interface PodDisruptionBudgetItem extends BaseItem {
  metadata: MetaData;
  spec: PodDisruptionBudgetSpec;
  status?: PodDisruptionBudgetStatus;
}

export type PodDisruptionBudgets = BaseClusterData<PodDisruptionBudgetItem>;

// NetworkPolicies
export interface NetworkPolicyLabelSelector {
  matchLabels?: Record<string, string>;
  matchExpressions?: Array<{
    key: string;
    operator: string;
    values?: string[];
  }>;
}

export interface NetworkPolicyPeer {
  namespaceSelector?: NetworkPolicyLabelSelector;
  podSelector?: NetworkPolicyLabelSelector;
  ipBlock?: {
    cidr?: string;
    except?: string[];
  };
}

export interface NetworkPolicyPort {
  protocol?: string;
  port?: number | string;
}

export interface NetworkPolicyRule {
  from?: NetworkPolicyPeer[];
  to?: NetworkPolicyPeer[];
  ports?: NetworkPolicyPort[];
}

export interface NetworkPolicySpec {
  podSelector: NetworkPolicyLabelSelector;
  policyTypes?: string[];
  ingress?: NetworkPolicyRule[];
  egress?: NetworkPolicyRule[];
}

export interface NetworkPolicyItem extends BaseItem {
  metadata: MetaData;
  spec: NetworkPolicySpec;
}

export type NetworkPolicies = BaseClusterData<NetworkPolicyItem>;

// PriorityClasses
export interface PriorityClassSpec {
  value: number;
  preemptionPolicy?: string;
  globalDefault?: boolean;
  description?: string;
}

export interface PriorityClassItem extends BaseItem {
  metadata: MetaData;
  value: number;
  preemptionPolicy?: string;
  globalDefault?: boolean;
  description?: string;
}

export type PriorityClasses = BaseClusterData<PriorityClassItem>;

// DaemonSets
export interface DaemonSetSpec {
  selector: {
    matchLabels: {
      [key: string]: string;
    };
  };
  template: {
    metadata: {
      labels: {
        [key: string]: string;
      };
    };
    spec: {
      containers: {
        name: string;
        image: string;
        resources?: {
          limits?: {
            cpu?: string;
            memory?: string;
          };
          requests?: {
            cpu?: string;
            memory?: string;
          };
        };
        livenessProbe?: ContainerProbe;
        readinessProbe?: ContainerProbe;
        startupProbe?: ContainerProbe;
        securityContext?: {
          runAsNonRoot?: boolean;
          runAsUser?: number;
          allowPrivilegeEscalation?: boolean;
          readOnlyRootFilesystem?: boolean;
          privileged?: boolean;
          seccompProfile?: {
            type?: string;
            localhostProfile?: string;
          };
          capabilities?: {
            drop?: string[];
            add?: string[];
          };
        };
      }[];
      securityContext?: {
        runAsNonRoot?: boolean;
        runAsUser?: number;
        seccompProfile?: {
          type?: string;
          localhostProfile?: string;
        };
      };
      priorityClassName?: string;
      preemptionPolicy?: string;
      hostNetwork?: boolean;
      hostPID?: boolean;
      hostIPC?: boolean;
      nodeSelector: {
        [key: string]: string;
      };
    };
  };
}

export interface DaemonSetMetadata extends MetaData {
  labels?: Record<string, string>;
}

export interface DaemonSetItem extends BaseItem {
  metadata: DaemonSetMetadata;
  spec: DaemonSetSpec;
  status: DaemonSetStatus;
}

export interface DaemonSetStatus {
  currentNumberScheduled: number;
  numberReady: number;
  desiredNumberScheduled: number;
  numberUnavailable: number;
  numberAvailable: number;
}

export type DaemonSets = BaseClusterData<DaemonSetItem>;

// ReplicationControllers
export interface ReplicationControllerStatus {
  replicas?: number;
  readyReplicas?: number;
}

export interface ReplicationControllerSpec {
  replicas?: number;
  selector?: Record<string, string>;
}

export interface ReplicationControllerItem extends BaseItem {
  spec?: ReplicationControllerSpec;
  status: ReplicationControllerStatus;
}

export type ReplicationControllers = BaseClusterData<ReplicationControllerItem>;

export interface ServiceMetadata extends MetaData {
  creationTimestamp: Date;
  annotations?: Record<string, string>;
  labels?: Record<string, string>;
}

export interface ServiceSpec {
  selector?: Record<string, string>;
  type: string;
  ports: {
    port: number;
    name: string;
    protocol: string;
    targetPort: number;
  }[];
}
export interface ServiceItem extends BaseItem {
  metadata: ServiceMetadata;
  spec: ServiceSpec;
}

export type ServicesData = BaseClusterData<ServiceItem>;

export interface NamespaceMetaData extends MetaData {
  name: string;
  status?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  creationTimestamp?: string;
}

export interface NamespaceItem extends BaseItem {
  metadata: NamespaceMetaData;
}

export type NamespaceData = BaseClusterData<NamespaceItem>;

export interface ClusterData {
  configmaps: ConfigMaps;
  cronjobs: CronJobs;
  daemonsets: DaemonSets;
  deployments: Deployments;
  jobs: Jobs;
  name: string;
  namespaces: NamespaceData;
  networkpolicies: NetworkPolicies;
  nodes: Nodes;
  poddisruptionbudgets: PodDisruptionBudgets;
  priorityclasses: PriorityClasses;
  pods: Pods;
  replicasets: ReplicaSets;
  secrets: Secrets;
  statefulsets: StatefulSets;
  status: string;
  errors?: string;
  uuid: string;
  offline?: boolean;
}
