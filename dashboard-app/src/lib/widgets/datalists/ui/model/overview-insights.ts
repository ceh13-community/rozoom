import type { ClusterHealthChecks, WarningEventItem } from "$features/check-health/model/types";
import type { WorkloadOverview } from "$shared";
import {
  hasCoreMetricsSourcesUnavailable,
  METRICS_BANNER_PIPELINE,
  METRICS_BANNER_SUMMARY,
  parseMetricsEndpointSeverity,
} from "../common/metrics-banner-copy";

export type InsightSeverity =
  | "ok"
  | "warning"
  | "critical"
  | "unknown"
  | "unavailable"
  | "not_applicable";

export type OverviewResourceInsight = {
  key: keyof WorkloadOverview;
  title: string;
  route: string;
  quantity: number;
  severity: InsightSeverity;
  reason: string;
  kubectlHint: string;
};

export type OverviewUsageCard = {
  id: "cpu" | "memory" | "pods";
  title: string;
  percent: number | null;
  value: string;
  usedReserved: string;
  hint: string;
  severity: Exclude<InsightSeverity, "not_applicable">;
};

export type ControlPlaneCheck = {
  id: string;
  title: string;
  severity: InsightSeverity;
  detail: string;
};

const OVERVIEW_RESOURCE_ORDER: Array<keyof WorkloadOverview> = [
  "pods",
  "deployments",
  "daemonsets",
  "statefulsets",
  "replicasets",
  "jobs",
  "cronjobs",
  "nodes",
];

export function parsePercent(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/(-?\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, parsed));
}

export function averagePercent(values: Array<string | null | undefined>): number | null {
  const parsed = values.map(parsePercent).filter((value): value is number => value !== null);
  if (parsed.length === 0) return null;
  const total = parsed.reduce((sum, value) => sum + value, 0);
  return total / parsed.length;
}

export function severityFromPercent(
  percent: number | null,
): Exclude<InsightSeverity, "not_applicable"> {
  if (percent === null) return "unknown";
  if (percent >= 90) return "critical";
  if (percent >= 75) return "warning";
  return "ok";
}

export function parseCpuQuantityToCores(value: string | null | undefined): number | null {
  if (!value) return null;
  if (value.endsWith("m")) {
    const millicores = Number(value.slice(0, -1));
    if (!Number.isFinite(millicores)) return null;
    return millicores / 1000;
  }
  const cores = Number(value);
  return Number.isFinite(cores) ? cores : null;
}

export function parseMemoryQuantityToBytes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/^([0-9]*\.?[0-9]+)\s*([A-Za-z]+)?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2].toUpperCase();
  const multiplier: Record<string, number> = {
    "": 1,
    KI: 1024,
    MI: 1024 ** 2,
    GI: 1024 ** 3,
    TI: 1024 ** 4,
    PI: 1024 ** 5,
    EI: 1024 ** 6,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
    P: 1000 ** 5,
    E: 1000 ** 6,
  };
  const factor = multiplier[unit];
  if (!factor) return null;
  return amount * factor;
}

export function calculateResourcePressure(
  nodeItems: unknown[],
  podItems: unknown[],
): {
  cpuPercent: number | null;
  memoryPercent: number | null;
  cpuRequestedCores: number;
  memoryRequestedBytes: number;
} {
  let allocatableCpu = 0;
  let allocatableMem = 0;
  let hasNodes = false;

  for (const item of nodeItems) {
    if (!item || typeof item !== "object") continue;
    const node = item as { status?: { allocatable?: { cpu?: string; memory?: string } } };
    const cpuRaw = node.status?.allocatable?.cpu;
    const memRaw = node.status?.allocatable?.memory;
    const cpu = parseCpuQuantityToCores(cpuRaw ?? null);
    const mem = parseMemoryQuantityToBytes(memRaw ?? null);
    if (cpu !== null && cpu > 0) {
      allocatableCpu += cpu;
      hasNodes = true;
    }
    if (mem !== null && mem > 0) {
      allocatableMem += mem;
      hasNodes = true;
    }
  }

  if (!hasNodes) {
    return { cpuPercent: null, memoryPercent: null, cpuRequestedCores: 0, memoryRequestedBytes: 0 };
  }

  let requestedCpu = 0;
  let requestedMem = 0;

  for (const item of podItems) {
    if (!item || typeof item !== "object") continue;
    const pod = item as {
      status?: { phase?: string };
      spec?: {
        containers?: Array<{ resources?: { requests?: { cpu?: string; memory?: string } } }>;
        initContainers?: Array<{
          resources?: { requests?: { cpu?: string; memory?: string } };
        }>;
      };
    };
    const phase = pod.status?.phase;
    if (phase !== "Running" && phase !== "Pending") continue;

    let podContainerCpu = 0;
    let podContainerMem = 0;
    const containers = pod.spec?.containers;
    if (Array.isArray(containers)) {
      for (const container of containers) {
        const cpuReq = parseCpuQuantityToCores(container.resources?.requests?.cpu ?? null);
        const memReq = parseMemoryQuantityToBytes(container.resources?.requests?.memory ?? null);
        if (cpuReq !== null && cpuReq > 0) podContainerCpu += cpuReq;
        if (memReq !== null && memReq > 0) podContainerMem += memReq;
      }
    }

    // Kubernetes effective pod requests = max(max(initContainer.requests), sum(container.requests)).
    // Init containers run one at a time before regular containers, so the scheduler reserves the
    // largest single init-container request rather than the sum.
    let podInitCpuMax = 0;
    let podInitMemMax = 0;
    const initContainers = pod.spec?.initContainers;
    if (Array.isArray(initContainers)) {
      for (const container of initContainers) {
        const cpuReq = parseCpuQuantityToCores(container.resources?.requests?.cpu ?? null);
        const memReq = parseMemoryQuantityToBytes(container.resources?.requests?.memory ?? null);
        if (cpuReq !== null && cpuReq > podInitCpuMax) podInitCpuMax = cpuReq;
        if (memReq !== null && memReq > podInitMemMax) podInitMemMax = memReq;
      }
    }

    requestedCpu += Math.max(podContainerCpu, podInitCpuMax);
    requestedMem += Math.max(podContainerMem, podInitMemMax);
  }

  const cpuPercent =
    allocatableCpu > 0 ? Math.max(0, Math.min(100, (requestedCpu / allocatableCpu) * 100)) : null;
  const memoryPercent =
    allocatableMem > 0 ? Math.max(0, Math.min(100, (requestedMem / allocatableMem) * 100)) : null;

  return {
    cpuPercent,
    memoryPercent,
    cpuRequestedCores: requestedCpu,
    memoryRequestedBytes: requestedMem,
  };
}

function formatCpuCores(value: number): string {
  return `${value.toFixed(2)} cores`;
}

function formatMemoryGiB(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

function severityFromGlobalStatus(
  status: "ok" | "warning" | "critical" | "unknown" | undefined,
): Exclude<InsightSeverity, "not_applicable"> {
  if (!status) return "unknown";
  if (status === "critical") return "critical";
  if (status === "warning") return "warning";
  if (status === "ok") return "ok";
  return "unknown";
}

function titleFromKey(key: keyof WorkloadOverview): string {
  if (key === "daemonsets") return "Daemon Sets";
  if (key === "statefulsets") return "Stateful Sets";
  if (key === "replicasets") return "Replica Sets";
  if (key === "cronjobs") return "Cron Jobs";
  if (key === "nodes") return "Nodes";
  if (key === "pods") return "Pods";
  if (key === "deployments") return "Deployments";
  return key;
}

function routeFromKey(key: keyof WorkloadOverview): string {
  if (key === "nodes") return "nodesstatus";
  return key;
}

function eventCountForKind(items: WarningEventItem[], kinds: string[]): number {
  const normalizedKinds = new Set(kinds.map((kind) => kind.toLowerCase()));
  return items.filter((item) => normalizedKinds.has(item.objectKind.toLowerCase())).length;
}

function eventSeverity(count: number): Exclude<InsightSeverity, "not_applicable"> {
  if (count >= 5) return "critical";
  if (count > 0) return "warning";
  return "ok";
}

function buildWorkloadReason(title: string, eventCount: number): string {
  if (eventCount <= 0) return `No warning events for ${title.toLowerCase()}.`;
  if (eventCount === 1) return "1 warning event.";
  return `${eventCount} warning events.`;
}

function parseReadyzEvidence(readyOutput: string | undefined, probes: string[]): string | null {
  if (!readyOutput) return null;
  const lines = readyOutput.split("\n").map((line) => line.trim());
  for (const line of lines) {
    const lower = line.toLowerCase();
    for (const probe of probes) {
      if (!lower.includes(probe.toLowerCase())) continue;
      return `API server /readyz note: ${line}`;
    }
  }
  return null;
}

function severityFromControlPlanePodStatus(
  status: "ok" | "warning" | "critical" | undefined,
): Exclude<InsightSeverity, "not_applicable"> {
  if (status === "ok") return "ok";
  if (status === "warning") return "warning";
  if (status === "critical") return "critical";
  return "unknown";
}

function buildComponentCheck(params: {
  id: string;
  title: string;
  readyOutput: string | undefined;
  probes: string[];
  podFallback?: { status: "ok" | "warning" | "critical"; message: string };
  isManagedCluster: boolean;
  managedDetail?: string;
  apiServerOk?: boolean;
}): ControlPlaneCheck {
  const readyzEvidence = parseReadyzEvidence(params.readyOutput, params.probes);

  if (params.podFallback) {
    return {
      id: params.id,
      title: params.title,
      severity: severityFromControlPlanePodStatus(params.podFallback.status),
      detail: readyzEvidence
        ? `${params.podFallback.message} ${readyzEvidence}`
        : params.podFallback.message,
    };
  }

  if (params.isManagedCluster) {
    const managedMsg = params.managedDetail ?? "Provider-managed: not directly accessible.";
    return {
      id: params.id,
      title: params.title,
      severity: "not_applicable",
      detail: readyzEvidence ? `${managedMsg} ${readyzEvidence}` : managedMsg,
    };
  }

  if (readyzEvidence) {
    return {
      id: params.id,
      title: params.title,
      severity: "unavailable",
      detail: `No visible kube-system control-plane pods. ${readyzEvidence}`,
    };
  }

  if (params.apiServerOk) {
    return {
      id: params.id,
      title: params.title,
      severity: "ok",
      detail: "Not visible as pods (may run as system containers). API server is healthy.",
    };
  }

  return {
    id: params.id,
    title: params.title,
    severity: "unavailable",
    detail: "No visible kube-system control-plane pods and no provider-managed fallback.",
  };
}

export function buildOverviewResourceInsights(
  overview: WorkloadOverview,
  checks: ClusterHealthChecks | null,
  warningItems: WarningEventItem[],
): OverviewResourceInsight[] {
  return OVERVIEW_RESOURCE_ORDER.map((key) => {
    const quantity = overview[key].quantity;
    const title = titleFromKey(key);
    const route = routeFromKey(key);
    const kubectlHint = `kubectl get ${route} --all-namespaces`;

    if (key === "nodes") {
      const status = checks?.nodes ? checks.nodes.summary.status.toLowerCase() : undefined;
      const pressures = checks?.nodes ? checks.nodes.summary.count.pressures : undefined;
      const pressureCount = pressures
        ? Object.values(pressures).reduce((sum, value) => sum + value, 0)
        : 0;
      const severity =
        status === "critical"
          ? "critical"
          : status === "warning" || pressureCount > 0
            ? "warning"
            : status === "ok"
              ? "ok"
              : "unknown";
      const reason =
        pressureCount > 0
          ? `${pressureCount} node pressure conditions.`
          : checks?.nodes?.summary.description || "Node health is within expected limits.";
      return { key, title, route, quantity, severity, reason, kubectlHint };
    }

    if (key === "pods") {
      const podIssues = checks?.podIssues;
      const crashLoop = podIssues?.crashLoopCount ?? 0;
      const pending = podIssues?.pendingCount ?? 0;
      const podStatus = podIssues?.status;
      const severity =
        crashLoop > 0
          ? "critical"
          : pending > 0
            ? "warning"
            : podStatus === "ok" || (crashLoop === 0 && pending === 0 && checks !== null)
              ? "ok"
              : severityFromGlobalStatus(podStatus);
      const reason =
        crashLoop > 0
          ? `${crashLoop} CrashLoopBackOff pod(s).`
          : pending > 0
            ? `${pending} pending pod(s).`
            : podIssues?.summary.message || "No pod issues from latest checks.";
      return { key, title, route, quantity, severity, reason, kubectlHint };
    }

    if (key === "cronjobs") {
      const summary = checks?.cronJobsHealth.summary;
      const critical = summary?.critical ?? 0;
      const warning = summary?.warning ?? 0;
      const severity = critical > 0 ? "critical" : warning > 0 ? "warning" : "ok";
      const reason =
        critical > 0
          ? `${critical} critical cronjob health item(s).`
          : warning > 0
            ? `${warning} warning cronjob health item(s).`
            : "No cronjob health problems.";
      return { key, title, route, quantity, severity, reason, kubectlHint };
    }

    const kindMap: Record<string, string[]> = {
      deployments: ["Deployment"],
      daemonsets: ["DaemonSet"],
      statefulsets: ["StatefulSet"],
      replicasets: ["ReplicaSet"],
      jobs: ["Job"],
    };
    const warningCount = eventCountForKind(warningItems, kindMap[key] ?? []);
    const severity = eventSeverity(warningCount);
    const reason = buildWorkloadReason(title, warningCount);
    return { key, title, route, quantity, severity, reason, kubectlHint };
  });
}

export type UsageMetricsMode = "actual" | "requested";

export function buildUsageCards(params: {
  cpuAveragePercent: number | null;
  memoryAveragePercent: number | null;
  podCount: number;
  podCapacity: number | null;
  cpuReservedCores?: number | null;
  memoryReservedBytes?: number | null;
  mode?: UsageMetricsMode;
}): OverviewUsageCard[] {
  const cpu = params.cpuAveragePercent;
  const memory = params.memoryAveragePercent;
  const isRequested = params.mode === "requested";
  const cpuUsed =
    cpu !== null &&
    params.cpuReservedCores !== null &&
    params.cpuReservedCores !== undefined &&
    params.cpuReservedCores > 0
      ? (params.cpuReservedCores * cpu) / 100
      : null;
  const memoryUsed =
    memory !== null &&
    params.memoryReservedBytes !== null &&
    params.memoryReservedBytes !== undefined &&
    params.memoryReservedBytes > 0
      ? (params.memoryReservedBytes * memory) / 100
      : null;
  const podsPercent =
    params.podCapacity && params.podCapacity > 0
      ? (params.podCount / params.podCapacity) * 100
      : null;

  const cpuLabel = isRequested ? "CPU requested" : "CPU usage";
  const memLabel = isRequested ? "Memory requested" : "Memory usage";
  const cpuHintAvailable = isRequested
    ? "Sum of pod CPU requests vs allocatable. Install metrics-server for actual usage."
    : "Average usage across nodes.";
  const memHintAvailable = isRequested
    ? "Sum of pod memory requests vs allocatable. Install metrics-server for actual usage."
    : "Average usage across nodes.";
  return [
    {
      id: "cpu",
      title: cpuLabel,
      percent: cpu,
      value: cpu === null ? "N/A" : `${cpu.toFixed(1)}%`,
      usedReserved:
        cpuUsed !== null && params.cpuReservedCores && params.cpuReservedCores > 0
          ? `${formatCpuCores(cpuUsed)} / ${formatCpuCores(params.cpuReservedCores)}`
          : "N/A / N/A",
      hint: cpu === null ? "CPU metrics unavailable." : cpuHintAvailable,
      severity: severityFromPercent(cpu),
    },
    {
      id: "memory",
      title: memLabel,
      percent: memory,
      value: memory === null ? "N/A" : `${memory.toFixed(1)}%`,
      usedReserved:
        memoryUsed !== null && params.memoryReservedBytes && params.memoryReservedBytes > 0
          ? `${formatMemoryGiB(memoryUsed)} / ${formatMemoryGiB(params.memoryReservedBytes)}`
          : "N/A / N/A",
      hint: memory === null ? "Memory metrics unavailable." : memHintAvailable,
      severity: severityFromPercent(memory),
    },
    {
      id: "pods",
      title: "Pods usage",
      percent: podsPercent,
      value:
        params.podCapacity && params.podCapacity > 0
          ? `${params.podCount}/${params.podCapacity}`
          : `${params.podCount}/N/A`,
      usedReserved:
        params.podCapacity && params.podCapacity > 0
          ? `${params.podCount} / ${params.podCapacity}`
          : `${params.podCount} / N/A`,
      hint:
        params.podCapacity && params.podCapacity > 0
          ? "Scheduled pods vs allocatable pod slots."
          : "Pod allocatable capacity unavailable.",
      severity: severityFromPercent(podsPercent),
    },
  ];
}

export function buildMetricsUnavailableMessage(
  checks: ClusterHealthChecks | null,
  usageCards: OverviewUsageCard[],
  options?: { coreMetricsUnavailable?: boolean | null },
): string | null {
  const cpuCard = usageCards.find((card) => card.id === "cpu");
  const memoryCard = usageCards.find((card) => card.id === "memory");
  if (cpuCard?.percent !== null || memoryCard?.percent !== null) return null;
  if (options?.coreMetricsUnavailable === false) return METRICS_BANNER_PIPELINE;
  if (options?.coreMetricsUnavailable === true) return METRICS_BANNER_SUMMARY;
  if (!checks) return null;

  const endpointStatuses = checks.metricsChecks.endpoints as
    | Record<string, { status?: string }>
    | undefined;
  if (!hasCoreMetricsSourcesUnavailable(endpointStatuses)) return null;
  return METRICS_BANNER_SUMMARY;
}

export type ManagedProviderInfo = {
  managed: boolean;
  provider: string;
  label: string;
};

const PROVIDER_ID_PREFIXES: Array<{
  prefix: string;
  provider: string;
  label: string;
  managed: boolean;
}> = [
  { prefix: "aws://", provider: "aws", label: "AWS EKS", managed: true },
  { prefix: "gce://", provider: "gcp", label: "Google GKE", managed: true },
  { prefix: "azure://", provider: "azure", label: "Azure AKS", managed: true },
  { prefix: "do://", provider: "digitalocean", label: "DigitalOcean DOKS", managed: true },
  { prefix: "oci://", provider: "oracle", label: "Oracle OKE", managed: true },
  { prefix: "ibm://", provider: "ibm", label: "IBM Cloud IKS", managed: true },
  { prefix: "linode://", provider: "linode", label: "Linode LKE", managed: true },
  { prefix: "openstack://", provider: "ovh", label: "OVHcloud MKS", managed: true },
  { prefix: "scaleway://", provider: "scaleway", label: "Scaleway Kapsule", managed: true },
  { prefix: "vultr://", provider: "vultr", label: "Vultr VKE", managed: true },
  { prefix: "civo://", provider: "civo", label: "Civo K8s", managed: true },
  { prefix: "hcloud://", provider: "hetzner", label: "Hetzner Cloud", managed: false },
  { prefix: "hrobot://", provider: "hetzner", label: "Hetzner Robot", managed: false },
];

const HINT_PATTERNS: Array<{
  pattern: (v: string) => boolean;
  provider: string;
  label: string;
  managed: boolean;
}> = [
  {
    pattern: (v) => v.startsWith("arn:aws:eks:") || v.includes(".eks.amazonaws.com"),
    provider: "aws",
    label: "AWS EKS",
    managed: true,
  },
  {
    pattern: (v) => v.includes("gke_") || v.includes(".gke."),
    provider: "gcp",
    label: "Google GKE",
    managed: true,
  },
  {
    pattern: (v) => v.includes("azmk8s.io") || v.includes(".aks."),
    provider: "azure",
    label: "Azure AKS",
    managed: true,
  },
  {
    pattern: (v) => v.includes(".k8s.ondigitalocean.com"),
    provider: "digitalocean",
    label: "DigitalOcean DOKS",
    managed: true,
  },
  {
    pattern: (v) => v.includes(".rancher.") || v.includes("rancher"),
    provider: "rancher",
    label: "Rancher",
    managed: false,
  },
  {
    pattern: (v) => v.includes(".lke.linode.") || v.includes("lke-") || v.includes("linodelke.net"),
    provider: "linode",
    label: "Linode LKE",
    managed: true,
  },
  {
    pattern: (v) => v.includes(".k8s.ovh.net"),
    provider: "ovh",
    label: "OVHcloud MKS",
    managed: true,
  },
  {
    pattern: (v) => v.includes(".api.k8s.") && v.includes(".scw.cloud"),
    provider: "scaleway",
    label: "Scaleway Kapsule",
    managed: true,
  },
  {
    pattern: (v) => v.includes(".vultr-k8s.com") || v.includes("vke-"),
    provider: "vultr",
    label: "Vultr VKE",
    managed: true,
  },
  {
    pattern: (v) => v.includes(".k8s.civo.com"),
    provider: "civo",
    label: "Civo K8s",
    managed: true,
  },
];

export function detectManagedProvider(
  providerIds: string[],
  hints: Array<string | null | undefined> = [],
): boolean {
  return detectManagedProviderInfo(providerIds, hints).managed;
}

export function detectManagedProviderInfo(
  providerIds: string[],
  hints: Array<string | null | undefined> = [],
): ManagedProviderInfo {
  const notManaged: ManagedProviderInfo = {
    managed: false,
    provider: "self-managed",
    label: "Self-managed",
  };

  for (const providerId of providerIds) {
    const lower = providerId.toLowerCase();
    for (const entry of PROVIDER_ID_PREFIXES) {
      if (lower.startsWith(entry.prefix)) {
        return { managed: entry.managed, provider: entry.provider, label: entry.label };
      }
    }
  }

  const normalizedHints = hints
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());

  for (const hint of normalizedHints) {
    for (const entry of HINT_PATTERNS) {
      if (entry.pattern(hint)) {
        return { managed: entry.managed, provider: entry.provider, label: entry.label };
      }
    }
  }

  return notManaged;
}

export function buildControlPlaneChecks(params: {
  checks: ClusterHealthChecks | null;
  isManagedCluster: boolean;
  providerLabel?: string;
}): ControlPlaneCheck[] {
  const checks = params.checks;
  const providerLabel = params.providerLabel ?? "Cloud provider";
  const readyOutput = checks?.apiServerHealth ? checks.apiServerHealth.ready.output : undefined;
  const apiStatus = severityFromGlobalStatus(checks?.apiServerHealth?.status);
  const endpointStatuses = checks?.metricsChecks.endpoints as
    | Record<string, { status?: string }>
    | undefined;
  const kubeletStatus = parseMetricsEndpointSeverity(
    endpointStatuses?.["kubelet_cadvisor"]?.status,
  );
  const apfStatus = severityFromGlobalStatus(checks?.apfHealth?.status);
  const controlPlaneComponents = checks?.controlPlaneComponents;
  const managedDetail = `${providerLabel}-managed: not directly accessible.`;

  const etcdCheck: ControlPlaneCheck = params.isManagedCluster
    ? {
        id: "etcd",
        title: "ETCD",
        severity: "not_applicable",
        detail: `${providerLabel}-managed etcd.`,
      }
    : {
        id: "etcd",
        title: "ETCD",
        severity: severityFromGlobalStatus(checks?.etcdHealth?.status),
        detail: checks?.etcdHealth?.summary.warnings[0] || "Endpoint and leader health.",
      };

  return [
    {
      id: "api-server",
      title: "API server",
      severity: apiStatus,
      detail: checks?.apiServerHealth?.status
        ? `Status: ${checks.apiServerHealth.status}`
        : "No data.",
    },
    {
      id: "kubelet",
      title: "Kubelet",
      severity: kubeletStatus,
      detail: endpointStatuses?.["kubelet_cadvisor"]?.status || "No data.",
    },
    {
      ...buildComponentCheck({
        id: "scheduler",
        title: "Scheduler",
        readyOutput,
        probes: ["scheduler"],
        podFallback: controlPlaneComponents?.scheduler,
        isManagedCluster: params.isManagedCluster,
        managedDetail,
        apiServerOk: apiStatus === "ok",
      }),
    },
    {
      ...buildComponentCheck({
        id: "controller-manager",
        title: "Controller manager",
        readyOutput,
        probes: ["controller-manager", "controller manager"],
        podFallback: controlPlaneComponents?.controllerManager,
        isManagedCluster: params.isManagedCluster,
        managedDetail,
        apiServerOk: apiStatus === "ok",
      }),
    },
    etcdCheck,
    {
      id: "apf",
      title: "APF",
      severity: apfStatus,
      detail: checks?.apfHealth?.summary.message || "API Priority and Fairness queue health.",
    },
  ];
}
