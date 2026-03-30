import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { discoverPrometheusService } from "$shared/api/discover-prometheus";
import { parseBytes } from "$shared/metrics/resolvers/cpu-mem.kubelet";

interface ResourceAllocation {
  cpuCores: number;
  memBytes: number;
}

const DEFAULT_ALLOCATION: ResourceAllocation = {
  cpuCores: 0,
  memBytes: 0,
};

/**
 * Generic resolver interface.
 */
export interface MetricResolver<TOut> {
  id: string;
  title: string;
  canResolve(input: { clusterId: string }): Promise<boolean>;
  resolve(input: { clusterId: string; nodeName?: string }): Promise<TOut>;
}

export type NodeCpuMem = { name: string; cpu: string; memory: string };
type NodeDisk = { name: string; freeGiB: number };

type PrometheusVectorItem = {
  metric?: Record<string, string>;
  value?: [number | string, string];
};

type PrometheusQueryResponse = {
  status?: string;
  data?: {
    resultType?: string;
    result?: PrometheusVectorItem[];
  };
  error?: string;
};

function cpuCoresToPercent(usageNanoCores: number, allocatableCores: number): string {
  if (allocatableCores <= 0) return "0%";

  const usedCores = usageNanoCores / 1e9;
  const pct = Math.max(0, Math.min(100, (usedCores / allocatableCores) * 100));

  return `${Math.round(pct)}%`;
}

function bytesToPercent(workingSetBytes: number, allocatableBytes: number): string {
  if (allocatableBytes <= 0) return "0%";

  const pct = Math.max(0, Math.min(100, (workingSetBytes / allocatableBytes) * 100));

  return `${Math.round(pct)}%`;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function getNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function toStringOrZero(v: unknown): string {
  if (typeof v === "string") return v;

  if (typeof v === "number" && Number.isFinite(v)) return String(v);

  return "0";
}

/**
 * kubelet summary node.fs can vary between versions/distros.
 * We normalize to a plain number in bytes.
 */
function normalizeAvailableBytesFromSummary(summary: unknown): number | null {
  if (!isObject(summary)) return null;

  const node = summary["node"];
  if (!isObject(node)) return null;

  const fs = node["fs"];
  if (!isObject(fs)) return null;

  const a1 = getNumber(fs["availableBytes"]);
  if (a1 !== null) return a1;

  const available = fs["available"];
  if (isObject(available)) {
    const a2 = getNumber(available["bytes"]);
    if (a2 !== null) return a2;
  }

  const a3 = getNumber(available);
  if (a3 !== null) return a3;

  const a4 = getNumber(fs["available_bytes"]);
  if (a4 !== null) return a4;

  return null;
}

function parseCpuCores(cpuString: string): number {
  if (cpuString.endsWith("m")) {
    return parseFloat(cpuString.slice(0, -1)) / 1000;
  }

  const value = parseFloat(cpuString);
  return isFinite(value) ? value : 0;
}

function getDeepProperty<R>(obj: unknown, path: string, defaultValue: R): R {
  if (!isObject(obj)) {
    return defaultValue;
  }

  const keys = path.split(".") as readonly string[];

  let current: unknown = obj;

  for (const key of keys) {
    if (!isObject(current)) {
      return defaultValue;
    }

    if (!(key in current)) {
      return defaultValue;
    }

    current = current[key];
  }

  return current as R;
}

function normalizeNodeName(raw: string): string {
  return raw.toLowerCase().trim();
}

function buildNodeNamesSet(nodeNames: string[]): Set<string> {
  return new Set(nodeNames.map(normalizeNodeName));
}

function stripPort(instance: string): string {
  const idx = instance.lastIndexOf(":");
  if (idx <= 0) return instance;
  return instance.slice(0, idx);
}

function resolveNodeNameFromMetric(
  metric: Record<string, string> | undefined,
  nodeNamesSet: Set<string>,
): string | null {
  if (!metric) return null;

  const candidates = [
    metric.node,
    metric.nodename,
    metric.kubernetes_node,
    metric.instance,
    metric.host,
    metric.hostname,
  ].filter((x): x is string => typeof x === "string" && x.length > 0);

  for (const candidate of candidates) {
    const host = stripPort(candidate);
    const direct = normalizeNodeName(host);

    if (nodeNamesSet.has(direct)) return direct;

    const short = normalizeNodeName(host.split(".")[0] ?? host);
    if (nodeNamesSet.has(short)) return short;

    const matched = [...nodeNamesSet].find(
      (node) => node === direct || node.startsWith(`${short}.`) || short.startsWith(`${node}.`),
    );
    if (matched) return matched;
  }

  return null;
}

function parsePrometheusVector(output: string): PrometheusVectorItem[] {
  const parsed = JSON.parse(output) as PrometheusQueryResponse;
  if (parsed.status !== "success") {
    throw new Error(parsed.error || "Prometheus query failed");
  }

  const result = parsed.data?.result;
  if (!Array.isArray(result)) return [];
  return result;
}

async function queryPrometheusVector(
  clusterId: string,
  query: string,
): Promise<PrometheusVectorItem[]> {
  const target = await discoverPrometheusService(clusterId);
  if (!target) throw new Error("Prometheus service not found");

  const encoded = encodeURIComponent(query);
  const path = `/api/v1/namespaces/${target.namespace}/services/http:${target.name}:${target.port}/proxy/api/v1/query?query=${encoded}`;
  const response = await kubectlRawFront(`get --raw ${path}`, { clusterId });
  if (response.errors.length > 0) throw new Error(response.errors);

  return parsePrometheusVector(response.output);
}

function parseVectorValue(item: PrometheusVectorItem): number | null {
  const raw = item.value?.[1];
  if (typeof raw !== "string") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

async function getNodeNames(clusterId: string): Promise<string[]> {
  const nodesRes = await kubectlRawFront("get nodes -o json", { clusterId });
  if (nodesRes.errors.length > 0) throw new Error(nodesRes.errors);

  const parsedNodes = JSON.parse(nodesRes.output) as unknown;
  const items =
    isObject(parsedNodes) && Array.isArray(parsedNodes["items"])
      ? (parsedNodes["items"] as unknown[])
      : [];

  return items
    .map((x) => {
      if (!isObject(x)) return null;
      const meta = x["metadata"];
      if (!isObject(meta)) return null;
      return typeof meta["name"] === "string" ? meta["name"] : null;
    })
    .filter((x): x is string => typeof x === "string");
}

/**
 * CPU/RAM: API (kubelet summary) resolver.
 */
export const cpuRamFromKubeletSummary: MetricResolver<NodeCpuMem[] | NodeCpuMem> = {
  id: "cpu-ram-kubelet-summary",
  title: "Kubelet Summary",
  async canResolve({ clusterId }) {
    const r = await kubectlRawFront("get nodes", { clusterId });
    return r.errors.length === 0;
  },
  async resolve({ clusterId, nodeName }) {
    const nodesRes = await kubectlRawFront("get nodes -o json", { clusterId });

    if (nodesRes.errors.length) throw new Error(nodesRes.errors);

    const parsedNodes = JSON.parse(nodesRes.output) as unknown;
    const items =
      isObject(parsedNodes) && Array.isArray(parsedNodes["items"])
        ? (parsedNodes["items"] as unknown[])
        : [];

    const getAlloc = (node: unknown) => {
      if (!isObject(node)) {
        return DEFAULT_ALLOCATION;
      }

      const allocatable = getDeepProperty(node, "status.allocatable", {});

      if (!isObject(allocatable)) {
        return DEFAULT_ALLOCATION;
      }

      const cpuRaw = toStringOrZero(allocatable.cpu);
      const memoryRaw = toStringOrZero(allocatable.memory);

      return {
        cpuCores: parseCpuCores(cpuRaw),
        memBytes: parseBytes(memoryRaw),
      };
    };

    const readOne = async (name: string): Promise<NodeCpuMem> => {
      const nodeObj = items.find((x) => {
        if (!isObject(x)) return false;
        const meta = x["metadata"];
        return isObject(meta) && meta["name"] === name;
      });

      const { cpuCores, memBytes } = getAlloc(nodeObj);

      const sumRes = await kubectlRawFront(`get --raw /api/v1/nodes/${name}/proxy/stats/summary`, {
        clusterId,
      });
      if (sumRes.errors.length) throw new Error(sumRes.errors);

      const summary = JSON.parse(sumRes.output) as unknown;

      let cpuNano = 0;
      let memWork = 0;

      if (isObject(summary)) {
        const node = summary["node"];
        if (isObject(node)) {
          const cpu = node["cpu"];
          const mem = node["memory"];
          if (isObject(cpu)) cpuNano = getNumber(cpu["usageNanoCores"]) ?? 0;
          if (isObject(mem)) memWork = getNumber(mem["workingSetBytes"]) ?? 0;
        }
      }

      return {
        name,
        cpu: cpuCores > 0 ? cpuCoresToPercent(cpuNano, cpuCores) : "0%",
        memory: memBytes > 0 ? bytesToPercent(memWork, memBytes) : "0%",
      };
    };

    if (nodeName) return readOne(nodeName);

    const names = items
      .map((x) => {
        if (!isObject(x)) return null;
        const meta = x["metadata"];
        if (!isObject(meta)) return null;
        return typeof meta["name"] === "string" ? meta["name"] : null;
      })
      .filter((x): x is string => typeof x === "string");

    return Promise.all(names.map(readOne));
  },
};

/**
 * CPU/RAM: prometheus resolver.
 */
export const cpuRamFromPrometheus: MetricResolver<NodeCpuMem[] | NodeCpuMem> = {
  id: "cpu-ram-prometheus",
  title: "Prometheus",
  async canResolve({ clusterId }) {
    const target = await discoverPrometheusService(clusterId);
    return Boolean(target);
  },
  async resolve({ clusterId, nodeName }) {
    const nodeNames = nodeName ? [nodeName] : await getNodeNames(clusterId);
    const nodeNamesSet = buildNodeNamesSet(nodeNames);
    const usageByNode = new Map<string, Partial<NodeCpuMem>>();

    const cpuQuery = '100 * (1 - avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])))';
    const memQuery = "100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))";
    const [cpuVector, memVector] = await Promise.all([
      queryPrometheusVector(clusterId, cpuQuery),
      queryPrometheusVector(clusterId, memQuery),
    ]);

    for (const item of cpuVector) {
      const value = parseVectorValue(item);
      if (value === null) continue;
      const node = resolveNodeNameFromMetric(item.metric, nodeNamesSet);
      if (!node) continue;

      const row = usageByNode.get(node) ?? { name: node };
      row.cpu = `${Math.round(Math.max(0, Math.min(100, value)))}%`;
      usageByNode.set(node, row);
    }

    for (const item of memVector) {
      const value = parseVectorValue(item);
      if (value === null) continue;
      const node = resolveNodeNameFromMetric(item.metric, nodeNamesSet);
      if (!node) continue;

      const row = usageByNode.get(node) ?? { name: node };
      row.memory = `${Math.round(Math.max(0, Math.min(100, value)))}%`;
      usageByNode.set(node, row);
    }

    const resolved = nodeNames
      .map((name) => normalizeNodeName(name))
      .map((name) => usageByNode.get(name))
      .filter((x): x is Partial<NodeCpuMem> => Boolean(x))
      .filter((x): x is NodeCpuMem => Boolean(x.name && x.cpu && x.memory));

    if (nodeName) {
      const one = resolved.find((x) => normalizeNodeName(x.name) === normalizeNodeName(nodeName));
      if (!one) throw new Error(`Prometheus returned no CPU/RAM data for node ${nodeName}`);
      return one;
    }

    if (resolved.length === 0) throw new Error("Prometheus returned no CPU/RAM data");
    return resolved;
  },
};

/**
 * Disk: kubelet summary resolver (fallback)
 */
export const diskFromKubeletSummary: MetricResolver<NodeDisk[] | NodeDisk> = {
  id: "disk-kubelet-summary",
  title: "Kubelet Summary (node.fs)",
  async canResolve({ clusterId }) {
    const r = await kubectlRawFront("get nodes", { clusterId });
    return r.errors.length === 0;
  },
  async resolve({ clusterId, nodeName }) {
    const nodesRes = await kubectlRawFront("get nodes -o json", { clusterId });
    if (nodesRes.errors.length) throw new Error(nodesRes.errors);

    const parsedNodes = JSON.parse(nodesRes.output) as unknown;
    const items =
      isObject(parsedNodes) && Array.isArray(parsedNodes["items"])
        ? (parsedNodes["items"] as unknown[])
        : [];

    const readOne = async (name: string) => {
      const sumRes = await kubectlRawFront(`get --raw /api/v1/nodes/${name}/proxy/stats/summary`, {
        clusterId,
      });
      if (sumRes.errors.length) throw new Error(sumRes.errors);

      const summary = JSON.parse(sumRes.output) as unknown;
      const availableBytes = normalizeAvailableBytesFromSummary(summary) ?? 0;

      const freeGiB = Number((availableBytes / 1024 / 1024 / 1024).toFixed(2));
      return { name, freeGiB };
    };

    if (nodeName) return readOne(nodeName);

    const names = items
      .map((x) => {
        if (!isObject(x)) return null;
        const meta = x["metadata"];
        if (!isObject(meta)) return null;
        return typeof meta["name"] === "string" ? meta["name"] : null;
      })
      .filter((x): x is string => typeof x === "string");

    return Promise.all(names.map(readOne));
  },
};

/**
 * Disk: prometheus resolver.
 */
export const diskFromPrometheus: MetricResolver<NodeDisk[] | NodeDisk> = {
  id: "disk-prometheus",
  title: "Prometheus",
  async canResolve({ clusterId }) {
    const target = await discoverPrometheusService(clusterId);
    return Boolean(target);
  },
  async resolve({ clusterId, nodeName }) {
    const nodeNames = nodeName ? [nodeName] : await getNodeNames(clusterId);
    const nodeNamesSet = buildNodeNamesSet(nodeNames);
    const query =
      'max by(instance) (node_filesystem_avail_bytes{mountpoint="/",fstype!~"tmpfs|overlay"}) / 1024 / 1024 / 1024';
    const vector = await queryPrometheusVector(clusterId, query);
    const byNode = new Map<string, NodeDisk>();

    for (const item of vector) {
      const value = parseVectorValue(item);
      if (value === null) continue;
      const node = resolveNodeNameFromMetric(item.metric, nodeNamesSet);
      if (!node) continue;

      const freeGiB = Number(value.toFixed(2));
      const existing = byNode.get(node);
      if (!existing || freeGiB > existing.freeGiB) {
        byNode.set(node, { name: node, freeGiB });
      }
    }

    if (nodeName) {
      const one = byNode.get(normalizeNodeName(nodeName));
      if (!one) throw new Error(`Prometheus returned no disk data for node ${nodeName}`);
      return one;
    }

    const result = nodeNames
      .map((name) => byNode.get(normalizeNodeName(name)))
      .filter((x): x is NodeDisk => Boolean(x));

    if (result.length === 0) throw new Error("Prometheus returned no disk data");
    return result;
  },
};
