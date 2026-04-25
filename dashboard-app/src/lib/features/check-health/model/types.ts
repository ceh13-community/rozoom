export type ContainerStatusState = {
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
};

export type PodRestart = {
  namespace: string;
  pod: string;
  containers: ContainerInfo[];
};

export type ContainerInfo = {
  containerName: string;
  namespace: string;
  lastState?: ContainerStatusState;
  ready: boolean;
  restartCount: number;
  startedAt?: string;
  state: ContainerStatusState;
};

export type NodeCheck = {
  metadata: {
    name: string;
    creationTimestamp: string;
  };
  status: {
    conditions?: {
      lastHeartbeatTime: string;
      lastTransitionTime: string;
      message: string;
      reason: string;
      status: string;
      type: string;
    }[];
  };
  role?: string;
};

export type NodeCheckSummary = {
  className: string;
  description?: string;
  status: string;
  count: {
    ready: number;
    total: number;
    pressures?: {
      diskPressure: number;
      memoryPressure: number;
      pidPressure: number;
      networkUnavailable: number;
    };
  };
};

export type CronJobHealthStatus = "ok" | "warning" | "critical" | "unknown";

export type CronJobHealthItem = {
  namespace: string;
  name: string;
  schedule: string;
  lastScheduleTime?: string;
  lastSuccessfulTime?: string;
  status: CronJobHealthStatus;
  reason: string;
};

export type CronJobsHealthSummary = {
  total: number;
  ok: number;
  warning: number;
  critical: number;
  unknown: number;
};

export type CronJobsHealth = {
  items: CronJobHealthItem[];
  summary: CronJobsHealthSummary;
  updatedAt: number;
  error?: string;
};

export type ApiServerEndpointCheck = {
  ok: boolean;
  output: string;
  error?: string;
};

export type ApiServerHealthStatus = "ok" | "warning" | "critical" | "unknown";

export type ApiServerHealth = {
  live: ApiServerEndpointCheck;
  ready: ApiServerEndpointCheck;
  status: ApiServerHealthStatus;
  updatedAt: number;
};

export type ControlPlaneComponentStatus = "ok" | "warning" | "critical";

export type ControlPlaneComponentPodReport = {
  source: "pod";
  status: ControlPlaneComponentStatus;
  matchedPods: number;
  readyPods: number;
  totalRestarts: number;
  podNames: string[];
  message: string;
};

export type ControlPlaneComponentsReport = {
  scheduler?: ControlPlaneComponentPodReport;
  controllerManager?: ControlPlaneComponentPodReport;
  updatedAt: number;
};

export type ApiServerLatencyStatus = "ok" | "warning" | "critical" | "unknown";

export type ApiServerLatencyQuantiles = {
  p50?: number;
  p95?: number;
  p99?: number;
};

export type ApiServerLatencyGroup = {
  verb?: string;
  resource?: string;
  quantiles: ApiServerLatencyQuantiles;
};

export type ApiServerLatencySummary = {
  status: ApiServerLatencyStatus;
  message?: string;
  warnings: string[];
  updatedAt: number;
};

export type ApiServerLatencyReport = {
  status: ApiServerLatencyStatus;
  summary: ApiServerLatencySummary;
  overall: ApiServerLatencyQuantiles;
  groups: ApiServerLatencyGroup[];
  errors?: string;
  updatedAt: number;
};

export type CertificateStatus = "ok" | "warning" | "critical" | "unknown";

export type CertificateItem = {
  name: string;
  expiresAt?: string;
  residual?: string;
  daysLeft?: number;
  status: CertificateStatus;
};

export type KubeletRotationStatus = "enabled" | "disabled" | "unknown";

export type KubeletRotationItem = {
  node: string;
  rotateClient?: boolean;
  rotateServer?: boolean;
  status: KubeletRotationStatus;
  message?: string;
};

export type CertificatesSummary = {
  status: CertificateStatus;
  message?: string;
  warnings: string[];
  updatedAt: number;
};

export type CertificatesReport = {
  status: CertificateStatus;
  summary: CertificatesSummary;
  certificates: CertificateItem[];
  kubeletRotation: KubeletRotationItem[];
  /**
   * True when a kube-apiserver static pod was found in kube-system (i.e.
   * a kubeadm-style cluster). When false, the control plane is managed
   * (Rancher / RKE2 / GKE / EKS etc.) and the kubeadm cert check is not
   * applicable - callers should surface TLS/cert-manager data instead
   * of flagging this as a failure.
   */
  controlPlaneDetected?: boolean;
  errors?: string;
  updatedAt: number;
};

export type PodIssueStatus = "ok" | "warning" | "critical" | "unknown";

export type PodIssueType = "crashloop" | "pending";

export type PodIssueItem = {
  namespace: string;
  pod: string;
  type: PodIssueType;
  status: PodIssueStatus;
  restarts: number;
  ageMinutes?: number;
  reason?: string;
};

export type PodIssuesSummary = {
  status: PodIssueStatus;
  message?: string;
  warnings: string[];
  updatedAt: number;
};

export type PodIssuesReport = {
  status: PodIssueStatus;
  summary: PodIssuesSummary;
  items: PodIssueItem[];
  totalPods: number;
  crashLoopCount: number;
  pendingCount: number;
  errors?: string;
  updatedAt: number;
};

export type ResourcesHygieneStatus =
  | "ok"
  | "warning"
  | "critical"
  | "unreachable"
  | "insufficient"
  | "unknown";

export type ResourcesQosClass = "Guaranteed" | "Burstable" | "BestEffort" | "Unknown";

export type ResourcesHygieneItem = {
  namespace: string;
  workload: string;
  workloadType: string;
  container: string;
  missing: string[];
  optionalMissing: string[];
  qosClass: ResourcesQosClass;
};

export type ResourcesHygieneWorkload = {
  namespace: string;
  workload: string;
  workloadType: string;
  status: ResourcesHygieneStatus;
  qosClass: ResourcesQosClass;
  missing: string[];
  optionalMissing: string[];
};

export type ResourcesHygieneSummary = {
  status: ResourcesHygieneStatus;
  message: string;
  total: number;
  ok: number;
  warning: number;
  critical: number;
  bestEffort: number;
  updatedAt: number;
};

export type ResourcesHygieneReport = {
  status: ResourcesHygieneStatus;
  summary: ResourcesHygieneSummary;
  workloads: ResourcesHygieneWorkload[];
  items: ResourcesHygieneItem[];
  errors?: string;
  updatedAt: number;
};

export type HpaCheckStatus =
  | "ok"
  | "warning"
  | "critical"
  | "unreachable"
  | "insufficient"
  | "unknown";

export type HpaMetricType = "cpu" | "memory" | "custom" | "external" | "unknown";

export type HpaMetricUsage = {
  types: HpaMetricType[];
  labels: string[];
};

export type HpaCheckItem = {
  namespace: string;
  workload: string;
  workloadType: string;
  hpaName: string;
  minReplicas?: number;
  maxReplicas?: number;
  currentReplicas?: number;
  desiredReplicas?: number;
  metrics: HpaMetricUsage;
  status: HpaCheckStatus;
  reason?: string;
  message?: string;
  scalingActive: boolean | null;
};

export type HpaCheckSummary = {
  status: HpaCheckStatus;
  message: string;
  total: number;
  ok: number;
  warning: number;
  critical: number;
  updatedAt: number;
};

export type HpaCheckReport = {
  status: HpaCheckStatus;
  summary: HpaCheckSummary;
  items: HpaCheckItem[];
  errors?: string;
  updatedAt: number;
};

export type ProbesHealthStatus =
  | "ok"
  | "warning"
  | "critical"
  | "unreachable"
  | "insufficient"
  | "unknown";

export type ProbeType = "httpGet" | "tcpSocket" | "exec" | "unknown" | "missing";

export type ProbeSummary = {
  type: ProbeType;
  initialDelaySeconds?: number;
  timeoutSeconds?: number;
  periodSeconds?: number;
  failureThreshold?: number;
  successThreshold?: number;
};

export type ProbesHealthItem = {
  namespace: string;
  workload: string;
  workloadType: string;
  container: string;
  status: ProbesHealthStatus;
  issues: string[];
  hints: string[];
  readiness: ProbeSummary;
  liveness: ProbeSummary;
  startup: ProbeSummary;
};

export type ProbesHealthWorkload = {
  namespace: string;
  workload: string;
  workloadType: string;
  status: ProbesHealthStatus;
  issues: string[];
};

export type ProbesHealthSummary = {
  status: ProbesHealthStatus;
  message: string;
  total: number;
  ok: number;
  warning: number;
  critical: number;
  updatedAt: number;
};

export type ProbesHealthReport = {
  status: ProbesHealthStatus;
  summary: ProbesHealthSummary;
  workloads: ProbesHealthWorkload[];
  items: ProbesHealthItem[];
  errors?: string;
  updatedAt: number;
};

export type PodQosStatus =
  | "ok"
  | "warning"
  | "critical"
  | "unreachable"
  | "insufficient"
  | "unknown";

export type PodQosClass = "BestEffort" | "Burstable" | "Guaranteed" | "Unknown";

export type PodQosItem = {
  namespace: string;
  pod: string;
  workload: string;
  workloadType: string;
  qosClass: PodQosClass;
  status: PodQosStatus;
  missing: string[];
  recommendedQos: PodQosClass;
  recommendation: string;
  sampleConfig: string;
};

export type PodQosSummary = {
  status: PodQosStatus;
  message: string;
  total: number;
  ok: number;
  warning: number;
  critical: number;
  bestEffort: number;
  updatedAt: number;
};

export type PodQosReport = {
  status: PodQosStatus;
  summary: PodQosSummary;
  items: PodQosItem[];
  errors?: string;
  updatedAt: number;
};

export type VpaHealthStatus =
  | "ok"
  | "warning"
  | "critical"
  | "unreachable"
  | "insufficient"
  | "unknown";

export type VpaUpdateMode = "Off" | "Initial" | "Recommend" | "Auto" | "Unknown";

export type VpaRecommendation = {
  cpu?: string;
  memory?: string;
};

export type VpaRecommendationRange = {
  min?: VpaRecommendation;
  target?: VpaRecommendation;
  max?: VpaRecommendation;
};

export type VpaHealthItem = {
  namespace: string;
  workload: string;
  workloadType: string;
  vpaName: string;
  updateMode: VpaUpdateMode;
  hpaPresent: boolean;
  status: VpaHealthStatus;
  issues: string[];
  recommendation: VpaRecommendationRange | null;
};

export type VpaHealthSummary = {
  status: VpaHealthStatus;
  message: string;
  total: number;
  ok: number;
  warning: number;
  critical: number;
  updatedAt: number;
};

export type VpaHealthReport = {
  status: VpaHealthStatus;
  summary: VpaHealthSummary;
  items: VpaHealthItem[];
  errors?: string;
  updatedAt: number;
};

export type TopologyHaStatus =
  | "ok"
  | "warning"
  | "critical"
  | "unreachable"
  | "insufficient"
  | "unknown";

export type TopologySpreadStrategy = {
  hasTopologySpreadConstraints: boolean;
  hasRequiredAntiAffinity: boolean;
  hasPreferredAntiAffinity: boolean;
  topologyKeys: string[];
  whenUnsatisfiable: string[];
  maxSkews: number[];
};

export type TopologyPlacement = {
  nodes: string[];
  zones: string[];
};

export type TopologyHaItem = {
  namespace: string;
  workload: string;
  workloadType: string;
  replicas: number;
  status: TopologyHaStatus;
  issues: string[];
  hints: string[];
  strategy: TopologySpreadStrategy;
  placement: TopologyPlacement;
  recommendations: string[];
};

export type TopologyHaSummary = {
  status: TopologyHaStatus;
  message: string;
  total: number;
  ok: number;
  warning: number;
  critical: number;
  updatedAt: number;
};

export type TopologyHaReport = {
  status: TopologyHaStatus;
  summary: TopologyHaSummary;
  items: TopologyHaItem[];
  errors?: string;
  updatedAt: number;
};

export type PdbHealthStatus =
  | "ok"
  | "warning"
  | "critical"
  | "unreachable"
  | "insufficient"
  | "unknown";

export type PdbMode = "minAvailable" | "maxUnavailable" | "unknown";

export type PdbHealthItem = {
  namespace: string;
  workload: string;
  workloadType: string;
  replicas: number;
  pdbName?: string;
  mode: PdbMode;
  modeValue?: string;
  disruptionsAllowed?: number;
  status: PdbHealthStatus;
  issues: string[];
  recommendations: string[];
};

export type PdbHealthSummary = {
  status: PdbHealthStatus;
  message: string;
  total: number;
  ok: number;
  warning: number;
  critical: number;
  updatedAt: number;
};

export type PdbHealthReport = {
  status: PdbHealthStatus;
  summary: PdbHealthSummary;
  items: PdbHealthItem[];
  errors?: string;
  updatedAt: number;
};

export type PriorityHealthStatus =
  | "ok"
  | "warning"
  | "critical"
  | "unreachable"
  | "insufficient"
  | "unknown";

export type PriorityHealthItem = {
  namespace: string;
  workload: string;
  workloadType: string;
  priorityClassName: string;
  priorityValue?: number;
  preemptionPolicy: string;
  status: PriorityHealthStatus;
  issues: string[];
  recommendations: string[];
};

export type PriorityHealthSummary = {
  status: PriorityHealthStatus;
  message: string;
  total: number;
  ok: number;
  warning: number;
  critical: number;
  updatedAt: number;
};

export type PriorityHealthReport = {
  status: PriorityHealthStatus;
  summary: PriorityHealthSummary;
  items: PriorityHealthItem[];
  errors?: string;
  updatedAt: number;
};

export type PodSecurityStatus =
  | "ok"
  | "warning"
  | "critical"
  | "unreachable"
  | "insufficient"
  | "unknown";

export type PodSecurityNamespaceItem = {
  namespace: string;
  enforce: string;
  warn: string;
  audit: string;
  status: PodSecurityStatus;
  issues: string[];
  recommendations: string[];
};

export type PodSecurityViolationItem = {
  namespace: string;
  pod: string;
  container: string;
  enforceLevel: string;
  status: PodSecurityStatus;
  issues: string[];
  recommendations: string[];
};

export type PodSecuritySummary = {
  status: PodSecurityStatus;
  message: string;
  total: number;
  ok: number;
  warning: number;
  critical: number;
  updatedAt: number;
};

export type PodSecurityReport = {
  status: PodSecurityStatus;
  summary: PodSecuritySummary;
  namespaces: PodSecurityNamespaceItem[];
  items: PodSecurityViolationItem[];
  errors?: string;
  updatedAt: number;
};

export type NetworkIsolationStatus =
  | "ok"
  | "warning"
  | "critical"
  | "unreachable"
  | "insufficient"
  | "unsupported"
  | "unknown";

export type NetworkIsolationItem = {
  namespace: string;
  policyCount: number;
  defaultDenyIngress: boolean;
  defaultDenyEgress: boolean;
  allowIngress: boolean;
  allowEgress: boolean;
  allowDns: boolean;
  status: NetworkIsolationStatus;
  issues: string[];
  recommendations: string[];
};

export type NetworkIsolationSummary = {
  status: NetworkIsolationStatus;
  message: string;
  total: number;
  ok: number;
  warning: number;
  critical: number;
  updatedAt: number;
};

export type NetworkIsolationReport = {
  status: NetworkIsolationStatus;
  summary: NetworkIsolationSummary;
  items: NetworkIsolationItem[];
  errors?: string;
  updatedAt: number;
};

export type SecretsHygieneStatus =
  | "ok"
  | "warning"
  | "critical"
  | "unreachable"
  | "insufficient"
  | "unknown";

export type SecretsHygieneItem = {
  namespace: string;
  configMap: string;
  key: string;
  status: SecretsHygieneStatus;
  issues: string[];
  recommendations: string[];
};

export type SecretsHygieneSummary = {
  status: SecretsHygieneStatus;
  message: string;
  total: number;
  ok: number;
  warning: number;
  critical: number;
  updatedAt: number;
};

export type SecretsHygieneReport = {
  status: SecretsHygieneStatus;
  summary: SecretsHygieneSummary;
  items: SecretsHygieneItem[];
  encryptionStatus: "enabled" | "disabled" | "unknown";
  errors?: string;
  updatedAt: number;
};

export type SecurityHardeningStatus =
  | "ok"
  | "warning"
  | "critical"
  | "unreachable"
  | "insufficient"
  | "unknown";

export type SecurityHardeningItem = {
  namespace: string;
  workload: string;
  workloadType: string;
  container: string;
  psaLevel: string;
  status: SecurityHardeningStatus;
  issues: string[];
  recommendations: string[];
};

export type SecurityHardeningSummary = {
  status: SecurityHardeningStatus;
  message: string;
  total: number;
  ok: number;
  warning: number;
  critical: number;
  updatedAt: number;
};

export type SecurityHardeningReport = {
  status: SecurityHardeningStatus;
  summary: SecurityHardeningSummary;
  items: SecurityHardeningItem[];
  errors?: string;
  updatedAt: number;
};

export type AdmissionWebhookStatus = "ok" | "warning" | "critical" | "unknown";

export type AdmissionWebhookLatency = {
  p50?: number;
  p95?: number;
  p99?: number;
};

export type AdmissionWebhookItem = {
  name: string;
  operation?: string;
  type?: string;
  latency: AdmissionWebhookLatency;
  rejectRate?: number;
  failOpenRate?: number;
};

export type AdmissionWebhookSummary = {
  status: AdmissionWebhookStatus;
  message?: string;
  warnings: string[];
  updatedAt: number;
};

export type AdmissionWebhookReport = {
  status: AdmissionWebhookStatus;
  summary: AdmissionWebhookSummary;
  items: AdmissionWebhookItem[];
  totals: {
    rejectRate?: number;
    failOpenRate?: number;
    p99Latency?: number;
  };
  errors?: string;
  updatedAt: number;
};

export type WarningEventsStatus = "ok" | "warning" | "critical" | "unknown";

export type WarningEventItem = {
  timestamp: number;
  type: string;
  namespace: string;
  objectKind: string;
  objectName: string;
  reason: string;
  message: string;
  count: number;
};

export type WarningEventsSummary = {
  status: WarningEventsStatus;
  message?: string;
  warnings: string[];
  updatedAt: number;
};

export type WarningEventsReport = {
  status: WarningEventsStatus;
  summary: WarningEventsSummary;
  items: WarningEventItem[];
  errors?: string;
  updatedAt: number;
};

export type BlackboxProbeStatus = "ok" | "warning" | "critical" | "unknown";

export type BlackboxProbeItem = {
  target: string;
  source: "ingress" | "service";
  namespace: string;
  name: string;
  module?: string;
  durationSeconds?: number;
  sslExpiry?: number;
  sslDaysLeft?: number;
  status: BlackboxProbeStatus;
};

export type BlackboxProbeSummary = {
  status: BlackboxProbeStatus;
  message?: string;
  warnings: string[];
  updatedAt: number;
};

export type BlackboxProbeReport = {
  status: BlackboxProbeStatus;
  summary: BlackboxProbeSummary;
  items: BlackboxProbeItem[];
  errors?: string;
  updatedAt: number;
};

export type ApfHealthStatus = "ok" | "warning" | "critical" | "unknown";

export type ApfMetricSample = {
  inQueueRequests?: number;
  nominalLimitSeats?: number;
  concurrencyLimit?: number;
  rejectedTotal?: number;
  waitDurationSum?: number;
  waitDurationCount?: number;
  sampledAt: number;
};

export type ApfMetricRate = {
  queueUtilization?: number;
  rejectedPerMinute?: number;
  avgWaitSeconds?: number;
};

export type ApfHealthSummary = {
  status: ApfHealthStatus;
  message?: string;
  warnings: string[];
  updatedAt: number;
};

export type ApfHealthReport = {
  status: ApfHealthStatus;
  summary: ApfHealthSummary;
  metrics: ApfMetricSample | null;
  metricRates: ApfMetricRate;
  errors?: string;
  updatedAt: number;
};

export type EtcdEndpointHealth = {
  endpoint: string;
  ok: boolean;
  tookMs?: number;
  error?: string;
};

export type EtcdEndpointStatus = {
  endpoint: string;
  version?: string;
  dbSizeBytes?: number;
  raftTerm?: number;
  raftIndex?: number;
  leaderId?: number;
  isLeader?: boolean;
};

export type EtcdMetricSample = {
  endpoint: string;
  hasLeader?: number;
  leaderChangesTotal?: number;
  dbSizeBytes?: number;
  proposalsCommittedTotal?: number;
  sampledAt: number;
};

export type EtcdMetricRate = {
  leaderChangesPerHour?: number;
  dbSizeGrowthBytesPerHour?: number;
};

export type EtcdHealthStatus = "ok" | "warning" | "critical" | "unknown";

export type EtcdHealthSummary = {
  status: EtcdHealthStatus;
  warnings: string[];
  updatedAt: number;
};

export type EtcdHealthReport = {
  status: EtcdHealthStatus;
  summary: EtcdHealthSummary;
  health: EtcdEndpointHealth[];
  endpointStatus: EtcdEndpointStatus[];
  metrics: EtcdMetricSample[];
  metricRates: EtcdMetricRate;
  errors?: string;
  updatedAt: number;
};

export type ResourceQuotasStatus = "ok" | "warning" | "critical" | "unknown";

export type ResourceQuotasItem = {
  namespace: string;
  name: string;
  hardCpu?: string;
  usedCpu?: string;
  hardMemory?: string;
  usedMemory?: string;
};

export type ResourceQuotasSummary = {
  status: ResourceQuotasStatus;
  message: string;
  total: number;
  namespacesWithQuotas: number;
  namespacesWithoutQuotas: number;
  updatedAt: number;
};

export type ResourceQuotasReport = {
  status: ResourceQuotasStatus;
  summary: ResourceQuotasSummary;
  items: ResourceQuotasItem[];
  updatedAt: number;
};

export type LimitRangesStatus = "ok" | "warning" | "critical" | "unknown";

export type LimitRangesItem = {
  namespace: string;
  name: string;
};

export type LimitRangesSummary = {
  status: LimitRangesStatus;
  message: string;
  total: number;
  namespacesWithLimits: number;
  updatedAt: number;
};

export type LimitRangesReport = {
  status: LimitRangesStatus;
  summary: LimitRangesSummary;
  items: LimitRangesItem[];
  updatedAt: number;
};

export type StorageStatusStatus = "ok" | "warning" | "critical" | "unknown";

export type StorageClassItem = {
  name: string;
  provisioner: string;
  isDefault: boolean;
};

export type StoragePvcItem = {
  namespace: string;
  name: string;
  status: string;
  capacity?: string;
};

export type StorageStatusSummary = {
  status: StorageStatusStatus;
  message: string;
  storageClasses: number;
  totalPVCs: number;
  boundPVCs: number;
  pendingPVCs: number;
  lostPVCs: number;
  updatedAt: number;
};

export type StorageStatusReport = {
  status: StorageStatusStatus;
  summary: StorageStatusSummary;
  items: Array<StorageClassItem | StoragePvcItem>;
  updatedAt: number;
};

export type RbacOverviewStatus = "ok" | "warning" | "critical" | "unknown";

export type RbacOverviewSummary = {
  status: RbacOverviewStatus;
  message: string;
  totalBindings: number;
  clusterAdminBindings: number;
  overprivilegedCount: number;
  updatedAt: number;
};

export type RbacOverviewReport = {
  status: RbacOverviewStatus;
  summary: RbacOverviewSummary;
  updatedAt: number;
};

export type IngressStatusReport = {
  status: "ok" | "warning" | "critical" | "unknown";
  summary: {
    status: string;
    message: string;
    total: number;
    withTls: number;
    withoutTls: number;
    updatedAt: number;
  };
  items: Array<{ namespace: string; name: string; hosts: string; hasTls: boolean }>;
  updatedAt: number;
};

export type ServiceMeshReport = {
  status: "ok" | "warning" | "critical" | "unknown";
  detected: boolean;
  meshType: "istio" | "linkerd" | "none";
  updatedAt: number;
};

export type ImageFreshnessReport = {
  status: "ok" | "warning" | "critical" | "unknown";
  summary: {
    totalContainers: number;
    latestTagCount: number;
    noDigestCount: number;
  };
  updatedAt: number;
};

export type NodeUtilizationNode = {
  name: string;
  cpuCores: string;
  cpuPercent: number;
  memoryBytes: string;
  memoryPercent: number;
};

export type NodeUtilizationReport = {
  status: "ok" | "warning" | "critical" | "unknown";
  summary: {
    avgCpuPercent: number;
    avgMemoryPercent: number;
    maxCpuPercent: number;
    maxMemoryPercent: number;
    nodeCount: number;
  };
  nodes: NodeUtilizationNode[];
  updatedAt: number;
};

export type ClusterHealthChecks = {
  daemonSets: number;
  deployments: number;
  jobs: number;
  replicaSets: number;
  pods: number;
  statefulSets: number;
  namespaces: string[];
  podRestarts: PodRestart[];
  cronJobs: number;
  cronJobsHealth: CronJobsHealth;
  apiServerHealth?: ApiServerHealth;
  controlPlaneComponents?: ControlPlaneComponentsReport;
  apiServerLatency?: ApiServerLatencyReport;
  certificatesHealth?: CertificatesReport;
  podIssues?: PodIssuesReport;
  admissionWebhooks?: AdmissionWebhookReport;
  warningEvents?: WarningEventsReport;
  blackboxProbes?: BlackboxProbeReport;
  apfHealth?: ApfHealthReport;
  etcdHealth?: EtcdHealthReport;
  resourcesHygiene?: ResourcesHygieneReport;
  hpaStatus?: HpaCheckReport;
  probesHealth?: ProbesHealthReport;
  podQos?: PodQosReport;
  vpaStatus?: VpaHealthReport;
  topologyHa?: TopologyHaReport;
  pdbStatus?: PdbHealthReport;
  priorityStatus?: PriorityHealthReport;
  podSecurity?: PodSecurityReport;
  networkIsolation?: NetworkIsolationReport;
  secretsHygiene?: SecretsHygieneReport;
  securityHardening?: SecurityHardeningReport;
  resourceQuotas?: ResourceQuotasReport;
  limitRanges?: LimitRangesReport;
  storageStatus?: StorageStatusReport;
  rbacOverview?: RbacOverviewReport;
  ingressStatus?: IngressStatusReport;
  serviceMesh?: ServiceMeshReport;
  imageFreshness?: ImageFreshnessReport;
  nodeUtilization?: NodeUtilizationReport;
  nodes: {
    checks: NodeCheck[];
    summary: NodeCheckSummary;
  } | null;
  alertsSummary?: {
    status: "ok" | "degraded" | "unavailable";
    activeCount: number;
    source: "alertmanager" | "prometheus" | "events" | "none";
    lastRunAt: string | null;
    message: string;
  };
  armorSummary?: {
    status: "ok" | "degraded" | "unavailable";
    lastRunAt: string | null;
    message: string;
  };
  complianceSummary?: {
    status: "ok" | "degraded" | "unavailable";
    findingCount: number;
    lastRunAt: string | null;
    message: string;
  };
  trivySummary?: {
    status: "ok" | "degraded" | "unavailable";
    lastRunAt: string | null;
    message: string;
  };
  metricsSourcesSummary?: {
    status: "ok" | "degraded" | "unavailable";
    availableCount: number;
    totalCount: number;
    lastRunAt: string | null;
    message: string;
  };
  metricsChecks: MetricsChecks;
  diagnosticsSnapshots?: {
    configLoadedAt?: number;
    healthLoadedAt?: number;
  };
  timestamp: number;
  errors?: string;
};

export type MetricsChecks = {
  endpoints: {
    [key: string]: CheckMetricResult;
  };
  pipeline?: MetricsPipelineOverview;
};

export type MetricsPipelineSource = {
  id: "api" | "metrics_server" | "node_exporter" | "prometheus";
  title: string;
  available: boolean;
  checkedAt: string;
  reason?: string;
  recommendation?: string;
};

export type MetricsPipelineOverview = {
  fallbackOrder: Array<"api" | "metrics_server" | "node_exporter" | "prometheus">;
  sources: MetricsPipelineSource[];
  recommendations: string[];
  checkedAt: string;
};

export type CheckMetricResult = {
  error?: string;
  installed?: boolean;
  managedBy?: "helm" | "kubectl";
  namespace?: string;
  releaseName?: string;
  lastSync: string;
  status: string;
  title: string;
  url?: string;
};

export type HealthChecks = {
  [key: string]: Array<ClusterHealthChecks | ClusterCheckError>;
};

export type ClusterCheckError = {
  errors: string;
  timestamp: number;
};
