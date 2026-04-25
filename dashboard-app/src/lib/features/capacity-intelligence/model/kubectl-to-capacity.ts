/**
 * Adapters that turn raw kubectl / metrics.k8s.io JSON into the input shapes
 * expected by the existing workloads-management models (resource-heatmap,
 * bin-packing, cost-efficiency).
 *
 * metrics.k8s.io API is defined by the upstream metrics-server project:
 *   https://github.com/kubernetes-sigs/metrics-server/blob/master/docs/api.md
 *
 * Node allocatable vs capacity per the Kubernetes reference:
 *   https://kubernetes.io/docs/concepts/architecture/nodes/#capacity
 */

import {
  parseCpuToMillicores,
  parseMemoryToMiB,
} from "$features/workloads-management/model/resource-heatmap";

type K8sPodOwner = { kind?: string; name?: string };
type K8sResourceQuantities = { cpu?: string; memory?: string };
type K8sContainerSpec = {
  name?: string;
  resources?: { requests?: K8sResourceQuantities };
};
type K8sPodItem = {
  metadata?: {
    name?: string;
    namespace?: string;
    ownerReferences?: K8sPodOwner[];
  };
  spec?: {
    containers?: K8sContainerSpec[];
    initContainers?: K8sContainerSpec[];
  };
};

type K8sNodeItem = {
  metadata?: { name?: string };
  status?: {
    allocatable?: K8sResourceQuantities;
    capacity?: K8sResourceQuantities;
  };
};

type MetricsContainer = {
  name?: string;
  usage?: K8sResourceQuantities;
};
type MetricsPodItem = {
  metadata?: { name?: string; namespace?: string };
  containers?: MetricsContainer[];
};
type MetricsNodeItem = {
  metadata?: { name?: string };
  usage?: K8sResourceQuantities;
};

type PodRequest = {
  namespace: string;
  name: string;
  owner: { kind: string; name: string };
  containers: Array<{ name: string; cpuMillicores: number; memoryMiB: number }>;
};

type PodUsage = {
  namespace: string;
  name: string;
  containers: Array<{ name: string; cpuMillicores: number; memoryMiB: number }>;
};

/**
 * Deduces the workload a pod belongs to from its ownerReferences chain.
 * ReplicaSet name is always `<deployment>-<hash>`, so for RS owners we strip
 * the hash suffix. StatefulSet / DaemonSet / Job owners give the workload
 * name directly. For pods without controllers (rare, mostly static pods) we
 * fall back to the pod name itself and mark them as bare-Pod.
 */
export function workloadFromOwners(
  ownerRefs: K8sPodOwner[] | undefined,
  podName: string,
): { kind: string; name: string } {
  const ref = ownerRefs?.find((o) => o.kind && o.name);
  if (!ref || !ref.kind || !ref.name) {
    return { kind: "Pod", name: podName };
  }
  if (ref.kind === "ReplicaSet") {
    // Strip the trailing hash suffix that kube-controller-manager adds.
    const trimmed = ref.name.replace(/-[a-f0-9]{7,10}$/, "");
    return { kind: "Deployment", name: trimmed || ref.name };
  }
  return { kind: ref.kind, name: ref.name };
}

function sumContainerQuantities(containers: K8sContainerSpec[] | undefined): {
  cpuMillicores: number;
  memoryMiB: number;
  perContainer: PodRequest["containers"];
} {
  let cpu = 0;
  let mem = 0;
  const perContainer: PodRequest["containers"] = [];
  for (const c of containers ?? []) {
    if (!c.name) continue;
    const cpuM = parseCpuToMillicores(c.resources?.requests?.cpu);
    const memM = parseMemoryToMiB(c.resources?.requests?.memory);
    cpu += cpuM;
    mem += memM;
    perContainer.push({ name: c.name, cpuMillicores: cpuM, memoryMiB: memM });
  }
  return { cpuMillicores: cpu, memoryMiB: mem, perContainer };
}

export function podRequestsFromJson(response: { items?: K8sPodItem[] } | null): PodRequest[] {
  const out: PodRequest[] = [];
  for (const item of response?.items ?? []) {
    const name = item.metadata?.name;
    const namespace = item.metadata?.namespace;
    if (!name || !namespace) continue;
    const owner = workloadFromOwners(item.metadata?.ownerReferences, name);
    // initContainers only run once, their requests still count toward
    // scheduler decisions but overlap with regular containers. K8s takes
    // max(sum(initContainers), sum(regular)). We approximate by adding
    // regular container requests only, matching how kube-scheduler bills
    // running state. Init requests dominate only during startup.
    const { perContainer } = sumContainerQuantities(item.spec?.containers);
    out.push({ namespace, name, owner, containers: perContainer });
  }
  return out;
}

export function podUsageFromMetrics(response: { items?: MetricsPodItem[] } | null): PodUsage[] {
  const out: PodUsage[] = [];
  for (const item of response?.items ?? []) {
    const name = item.metadata?.name;
    const namespace = item.metadata?.namespace;
    if (!name || !namespace) continue;
    const containers: PodUsage["containers"] = [];
    for (const c of item.containers ?? []) {
      if (!c.name) continue;
      containers.push({
        name: c.name,
        cpuMillicores: parseCpuToMillicores(c.usage?.cpu),
        memoryMiB: parseMemoryToMiB(c.usage?.memory),
      });
    }
    out.push({ namespace, name, containers });
  }
  return out;
}

/**
 * Join pod-level requests from `kubectl get pods -A -o json` with the
 * metrics.k8s.io usage samples. Rolls up to the workload level so the
 * heatmap grids by Deployment/StatefulSet/DaemonSet rather than raw pod.
 */
export type WorkloadMetric = {
  namespace: string;
  workload: string;
  workloadType: string;
  cpuRequestMillicores: number;
  cpuUsageMillicores: number;
  memoryRequestMiB: number;
  memoryUsageMiB: number;
};

export function joinWorkloadMetrics(requests: PodRequest[], usages: PodUsage[]): WorkloadMetric[] {
  const usageByPod = new Map<string, PodUsage>();
  for (const u of usages) {
    usageByPod.set(`${u.namespace}/${u.name}`, u);
  }

  const byWorkload = new Map<string, WorkloadMetric>();
  for (const p of requests) {
    const key = `${p.namespace}/${p.owner.kind}/${p.owner.name}`;
    const usage = usageByPod.get(`${p.namespace}/${p.name}`);

    const cpuReq = p.containers.reduce((s, c) => s + c.cpuMillicores, 0);
    const memReq = p.containers.reduce((s, c) => s + c.memoryMiB, 0);
    const cpuUse = usage?.containers.reduce((s, c) => s + c.cpuMillicores, 0) ?? 0;
    const memUse = usage?.containers.reduce((s, c) => s + c.memoryMiB, 0) ?? 0;

    const existing = byWorkload.get(key);
    if (existing) {
      existing.cpuRequestMillicores += cpuReq;
      existing.cpuUsageMillicores += cpuUse;
      existing.memoryRequestMiB += memReq;
      existing.memoryUsageMiB += memUse;
    } else {
      byWorkload.set(key, {
        namespace: p.namespace,
        workload: p.owner.name,
        workloadType: p.owner.kind,
        cpuRequestMillicores: cpuReq,
        cpuUsageMillicores: cpuUse,
        memoryRequestMiB: memReq,
        memoryUsageMiB: memUse,
      });
    }
  }
  return Array.from(byWorkload.values());
}

/**
 * Aggregate workload metrics into per-namespace totals for cost-efficiency
 * analysis.
 */
export type NamespaceMetric = {
  namespace: string;
  cpuRequestMillicores: number;
  cpuUsageMillicores: number;
  memoryRequestMiB: number;
  memoryUsageMiB: number;
};

export function aggregateByNamespace(metrics: WorkloadMetric[]): NamespaceMetric[] {
  const byNs = new Map<string, NamespaceMetric>();
  for (const m of metrics) {
    const existing = byNs.get(m.namespace);
    if (existing) {
      existing.cpuRequestMillicores += m.cpuRequestMillicores;
      existing.cpuUsageMillicores += m.cpuUsageMillicores;
      existing.memoryRequestMiB += m.memoryRequestMiB;
      existing.memoryUsageMiB += m.memoryUsageMiB;
    } else {
      byNs.set(m.namespace, {
        namespace: m.namespace,
        cpuRequestMillicores: m.cpuRequestMillicores,
        cpuUsageMillicores: m.cpuUsageMillicores,
        memoryRequestMiB: m.memoryRequestMiB,
        memoryUsageMiB: m.memoryUsageMiB,
      });
    }
  }
  return Array.from(byNs.values());
}

/**
 * Nodes for bin-packing: allocatable = node.status.allocatable, which is
 * what kube-scheduler actually uses. requested = sum of all pods currently
 * assigned to the node via spec.nodeName. If we do not have nodeName on the
 * pod we skip it (pending pods) - they are not part of the packing score
 * until they land.
 */
type PodOnNode = {
  nodeName: string;
  cpuRequestMillicores: number;
  memoryRequestMiB: number;
};

export function podsOnNodesFromJson(
  response: {
    items?: Array<{
      spec?: { nodeName?: string; containers?: K8sContainerSpec[] };
    }>;
  } | null,
): PodOnNode[] {
  const out: PodOnNode[] = [];
  for (const item of response?.items ?? []) {
    const nodeName = item.spec?.nodeName;
    if (!nodeName) continue;
    const { cpuMillicores, memoryMiB } = sumContainerQuantities(item.spec?.containers);
    out.push({
      nodeName,
      cpuRequestMillicores: cpuMillicores,
      memoryRequestMiB: memoryMiB,
    });
  }
  return out;
}

export type NodeCapacityInput = {
  name: string;
  allocatableCpuMillicores: number;
  allocatableMemoryMiB: number;
  requestedCpuMillicores: number;
  requestedMemoryMiB: number;
};

export function nodesFromJson(
  response: { items?: K8sNodeItem[] } | null,
  podsOnNodes: PodOnNode[],
): NodeCapacityInput[] {
  const podSumByNode = new Map<string, { cpu: number; memory: number }>();
  for (const p of podsOnNodes) {
    const existing = podSumByNode.get(p.nodeName);
    if (existing) {
      existing.cpu += p.cpuRequestMillicores;
      existing.memory += p.memoryRequestMiB;
    } else {
      podSumByNode.set(p.nodeName, {
        cpu: p.cpuRequestMillicores,
        memory: p.memoryRequestMiB,
      });
    }
  }

  const out: NodeCapacityInput[] = [];
  for (const item of response?.items ?? []) {
    const name = item.metadata?.name;
    if (!name) continue;
    const alloc = item.status?.allocatable ?? item.status?.capacity;
    const summed = podSumByNode.get(name) ?? { cpu: 0, memory: 0 };
    out.push({
      name,
      allocatableCpuMillicores: parseCpuToMillicores(alloc?.cpu),
      allocatableMemoryMiB: parseMemoryToMiB(alloc?.memory),
      requestedCpuMillicores: summed.cpu,
      requestedMemoryMiB: summed.memory,
    });
  }
  return out;
}

export function nodeUsageFromMetrics(
  response: { items?: MetricsNodeItem[] } | null,
): Map<string, { cpuMillicores: number; memoryMiB: number }> {
  const out = new Map<string, { cpuMillicores: number; memoryMiB: number }>();
  for (const item of response?.items ?? []) {
    const name = item.metadata?.name;
    if (!name) continue;
    out.set(name, {
      cpuMillicores: parseCpuToMillicores(item.usage?.cpu),
      memoryMiB: parseMemoryToMiB(item.usage?.memory),
    });
  }
  return out;
}
