import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { discoverPrometheusService } from "$shared/api/discover-prometheus";
import {
  buildRecommendations,
  getMetricsSourceCapabilities,
  getMissingSourceIds,
  type MetricsFlowTrace,
  type MetricsSourceAttempt,
  type MetricsSourceCapability,
} from "./metrics-capabilities";

type PodMetricsResponse = {
  items?: Array<{
    metadata?: { name?: string; namespace?: string };
    containers?: Array<{ usage?: { cpu?: string; memory?: string } }>;
  }>;
};

type PrometheusVectorItem = {
  metric?: Record<string, string>;
  value?: [number | string, string];
};

type PrometheusQueryResponse = {
  status?: string;
  data?: { result?: PrometheusVectorItem[] };
  error?: string;
};

export type PodCpuMemMetricsValue = {
  cpu: string;
  memory: string;
  cpuMillicores: number;
  memoryBytes: number;
};

export type PodCpuMemResolution = {
  byKey: Map<string, PodCpuMemMetricsValue>;
  trace: MetricsFlowTrace;
  capabilities: MetricsSourceCapability[];
};

function metricsKey(namespace: string | undefined, name: string | undefined) {
  return `${namespace || "default"}/${name || ""}`;
}

function parseCpuToMillicores(value?: string): number | null {
  if (!value) return null;
  if (value.endsWith("m")) {
    const num = Number(value.replace("m", ""));
    return Number.isFinite(num) ? num : null;
  }
  if (value.endsWith("u")) {
    const num = Number(value.replace("u", ""));
    return Number.isFinite(num) ? num / 1000 : null;
  }
  if (value.endsWith("n")) {
    const num = Number(value.replace("n", ""));
    return Number.isFinite(num) ? num / 1_000_000 : null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num * 1000 : null;
}

function parseMemoryToBytes(value?: string): number | null {
  if (!value) return null;
  const match = value.match(/^([0-9.]+)([a-zA-Z]+)?$/);
  if (!match) return null;
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) return null;
  const unit = match[2] || "";
  const multipliers: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    Ei: 1024 ** 6,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
    P: 1000 ** 5,
    E: 1000 ** 6,
  };
  return numeric * (multipliers[unit] ?? 1);
}

function formatCpu(millicores: number | null) {
  if (millicores === null) return "-";
  return `${Math.round(millicores)}m`;
}

function formatMemory(bytes: number | null) {
  if (bytes === null) return "-";
  const mib = bytes / 1024 ** 2;
  return `${Math.round(mib)}Mi`;
}

function toPrometheusVector(output: string): PrometheusVectorItem[] {
  const parsed = JSON.parse(output) as PrometheusQueryResponse;
  if (parsed.status !== "success") {
    throw new Error(parsed.error || "Prometheus query failed");
  }
  return Array.isArray(parsed.data?.result) ? parsed.data.result : [];
}

async function forEachWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  if (items.length === 0) return;
  const normalizedLimit = Math.max(1, Math.min(limit, items.length));
  let index = 0;
  const runners = Array.from({ length: normalizedLimit }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      await worker(items[current]);
      if (current % 3 === 0) {
        await Promise.resolve();
      }
    }
  });
  await Promise.all(runners);
}

async function runPrometheusQuery(
  clusterId: string,
  query: string,
): Promise<PrometheusVectorItem[]> {
  const target = await discoverPrometheusService(clusterId);
  if (!target) throw new Error("Prometheus service not found");

  const encoded = encodeURIComponent(query);
  const path = `/api/v1/namespaces/${target.namespace}/services/http:${target.name}:${target.port}/proxy/api/v1/query?query=${encoded}`;
  const response = await kubectlRawFront(`get --raw ${path}`, { clusterId });

  if (response.errors.length > 0) {
    throw new Error(response.errors);
  }

  return toPrometheusVector(response.output);
}

async function fromMetricsServer(clusterId: string): Promise<Map<string, PodCpuMemMetricsValue>> {
  const response = await kubectlRawFront("get --raw /apis/metrics.k8s.io/v1beta1/pods", {
    clusterId,
  });
  if (response.errors || response.code !== 0) {
    throw new Error(response.errors || "Pod metrics unavailable");
  }

  const parsed = JSON.parse(response.output) as PodMetricsResponse;
  const next = new Map<string, PodCpuMemMetricsValue>();

  for (const item of parsed.items ?? []) {
    const name = item.metadata?.name;
    const namespace = item.metadata?.namespace ?? "default";
    if (!name) continue;

    let cpuTotal = 0;
    let memTotal = 0;
    let hasCpu = false;
    let hasMem = false;

    for (const container of item.containers ?? []) {
      const cpu = parseCpuToMillicores(container.usage?.cpu);
      const memory = parseMemoryToBytes(container.usage?.memory);
      if (cpu !== null) {
        cpuTotal += cpu;
        hasCpu = true;
      }
      if (memory !== null) {
        memTotal += memory;
        hasMem = true;
      }
    }

    next.set(metricsKey(namespace, name), {
      cpu: formatCpu(hasCpu ? cpuTotal : null),
      memory: formatMemory(hasMem ? memTotal : null),
      cpuMillicores: hasCpu ? cpuTotal : -1,
      memoryBytes: hasMem ? memTotal : -1,
    });
  }

  return next;
}

async function fromKubeletSummary(clusterId: string): Promise<Map<string, PodCpuMemMetricsValue>> {
  const nodes = await kubectlRawFront("get nodes -o json", { clusterId });
  if (nodes.errors.length > 0) throw new Error(nodes.errors);

  const parsedNodes = JSON.parse(nodes.output) as {
    items?: Array<{ metadata?: { name?: string } }>;
  };
  const nodeNames = (parsedNodes.items ?? [])
    .map((item) => item.metadata?.name)
    .filter((name): name is string => typeof name === "string" && name.length > 0);

  const byKey = new Map<string, { cpuMillicores: number; memoryBytes: number }>();

  await forEachWithConcurrency(nodeNames, 4, async (nodeName) => {
    const summary = await kubectlRawFront(
      `get --raw /api/v1/nodes/${nodeName}/proxy/stats/summary`,
      { clusterId },
    );
    if (summary.errors.length > 0) return;

    const parsed = JSON.parse(summary.output) as {
      pods?: Array<{
        podRef?: { name?: string; namespace?: string };
        containers?: Array<{
          cpu?: { usageNanoCores?: number };
          memory?: { workingSetBytes?: number };
        }>;
      }>;
    };

    for (const pod of parsed.pods ?? []) {
      const podName = pod.podRef?.name;
      const namespace = pod.podRef?.namespace ?? "default";
      if (!podName) continue;

      let cpuTotal = 0;
      let memTotal = 0;
      for (const container of pod.containers ?? []) {
        const cpuNano = container.cpu?.usageNanoCores;
        const memBytes = container.memory?.workingSetBytes;
        if (typeof cpuNano === "number" && Number.isFinite(cpuNano)) {
          cpuTotal += cpuNano / 1_000_000;
        }
        if (typeof memBytes === "number" && Number.isFinite(memBytes)) {
          memTotal += memBytes;
        }
      }

      const key = metricsKey(namespace, podName);
      const prev = byKey.get(key);
      byKey.set(key, {
        cpuMillicores: (prev?.cpuMillicores ?? 0) + cpuTotal,
        memoryBytes: (prev?.memoryBytes ?? 0) + memTotal,
      });
    }
  });

  const formatted = new Map<string, PodCpuMemMetricsValue>();
  for (const [key, value] of byKey.entries()) {
    formatted.set(key, {
      cpu: formatCpu(value.cpuMillicores),
      memory: formatMemory(value.memoryBytes),
      cpuMillicores: value.cpuMillicores,
      memoryBytes: value.memoryBytes,
    });
  }

  return formatted;
}

async function fromPrometheus(clusterId: string): Promise<Map<string, PodCpuMemMetricsValue>> {
  const cpuQuery =
    'sum by(namespace,pod) (rate(container_cpu_usage_seconds_total{container!="",pod!="",container!="POD"}[5m])) * 1000';
  const memQuery =
    'sum by(namespace,pod) (container_memory_working_set_bytes{container!="",pod!="",container!="POD"})';

  const [cpuVector, memVector] = await Promise.all([
    runPrometheusQuery(clusterId, cpuQuery),
    runPrometheusQuery(clusterId, memQuery),
  ]);

  const byKey = new Map<string, PodCpuMemMetricsValue>();

  for (const item of cpuVector) {
    const pod = item.metric?.pod;
    const namespace = item.metric?.namespace ?? "default";
    const raw = item.value?.[1];
    const value = typeof raw === "string" ? Number(raw) : null;
    if (!pod || value === null || !Number.isFinite(value)) continue;

    const key = metricsKey(namespace, pod);
    const prev = byKey.get(key) ?? { cpu: "-", memory: "-", cpuMillicores: -1, memoryBytes: -1 };
    byKey.set(key, {
      ...prev,
      cpu: formatCpu(value),
      cpuMillicores: value,
    });
  }

  for (const item of memVector) {
    const pod = item.metric?.pod;
    const namespace = item.metric?.namespace ?? "default";
    const raw = item.value?.[1];
    const value = typeof raw === "string" ? Number(raw) : null;
    if (!pod || value === null || !Number.isFinite(value)) continue;

    const key = metricsKey(namespace, pod);
    const prev = byKey.get(key) ?? { cpu: "-", memory: "-", cpuMillicores: -1, memoryBytes: -1 };
    byKey.set(key, {
      ...prev,
      memory: formatMemory(value),
      memoryBytes: value,
    });
  }

  return byKey;
}

function qualityFromSource(source: MetricsFlowTrace["resolvedFrom"]): MetricsFlowTrace["quality"] {
  if (source === "api" || source === "metrics_server") return "high";
  if (source === "prometheus") return "medium";
  return "low";
}

function sourceAvailable(
  capabilities: MetricsSourceCapability[],
  source: MetricsSourceAttempt["source"],
): boolean {
  return Boolean(capabilities.find((entry) => entry.id === source)?.available);
}

export async function resolvePodCpuMemWithTrace(clusterId: string): Promise<PodCpuMemResolution> {
  const attempts: MetricsSourceAttempt[] = [];
  const capabilities = await getMetricsSourceCapabilities(clusterId);

  const trySource = async (
    source: MetricsSourceAttempt["source"],
    loader: () => Promise<Map<string, PodCpuMemMetricsValue>>,
  ): Promise<Map<string, PodCpuMemMetricsValue> | null> => {
    const startedAt = Date.now();

    if (!sourceAvailable(capabilities, source)) {
      attempts.push({
        source,
        status: "skipped",
        latencyMs: Date.now() - startedAt,
        message: `${source} is not available`,
      });
      return null;
    }

    try {
      const data = await loader();
      attempts.push({
        source,
        status: data.size > 0 ? "success" : "failed",
        latencyMs: Date.now() - startedAt,
        message: `Resolved ${data.size} pod(s)`,
      });
      return data.size > 0 ? data : null;
    } catch (error) {
      attempts.push({
        source,
        status: "failed",
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };

  const apiData = await trySource("api", () => fromKubeletSummary(clusterId));
  if (apiData) {
    return {
      byKey: apiData,
      capabilities,
      trace: {
        metric: "cpu_memory",
        resolvedFrom: "api",
        quality: qualityFromSource("api"),
        attempts,
        missingSources: getMissingSourceIds(capabilities),
        recommendations: buildRecommendations(capabilities),
      },
    };
  }

  const metricsServerData = await trySource("metrics_server", () => fromMetricsServer(clusterId));
  if (metricsServerData) {
    return {
      byKey: metricsServerData,
      capabilities,
      trace: {
        metric: "cpu_memory",
        resolvedFrom: "metrics_server",
        quality: qualityFromSource("metrics_server"),
        attempts,
        missingSources: getMissingSourceIds(capabilities),
        recommendations: buildRecommendations(capabilities),
      },
    };
  }

  attempts.push({
    source: "node_exporter",
    status: sourceAvailable(capabilities, "node_exporter") ? "failed" : "skipped",
    latencyMs: 0,
    message: "node-exporter does not provide pod-level CPU/RAM metrics directly",
  });

  const promData = await trySource("prometheus", () => fromPrometheus(clusterId));
  if (promData) {
    return {
      byKey: promData,
      capabilities,
      trace: {
        metric: "cpu_memory",
        resolvedFrom: "prometheus",
        quality: qualityFromSource("prometheus"),
        attempts,
        missingSources: getMissingSourceIds(capabilities),
        recommendations: buildRecommendations(capabilities),
      },
    };
  }

  return {
    byKey: new Map(),
    capabilities,
    trace: {
      metric: "cpu_memory",
      resolvedFrom: null,
      quality: "low",
      attempts,
      missingSources: getMissingSourceIds(capabilities),
      recommendations: buildRecommendations(capabilities),
    },
  };
}
