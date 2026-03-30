import { get, writable } from "svelte/store";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { getClusterNodesNames } from "$shared/api/tauri";
import { checkMetricsServer } from "$features/check-health";
import { checkKubeStateMetrics } from "$features/check-health";
import { checkNodeExporter } from "$features/check-health";
import { updateClusterCheckPartially } from "$features/check-health/model/cache-store";
import { checkResponseStatus } from "$shared/lib/parsers";
import {
  clusterRuntimeContext,
  isClusterRuntimePlaneActive,
} from "$shared/lib/cluster-runtime-manager";
import {
  activeDashboardRoute,
  isDashboardFeatureRouteActive,
} from "$shared/lib/dashboard-route-activity";
import type {
  MetricsSourceCheck,
  MetricsSourceEndpoint,
  MetricsSourceStatus,
  MetricsSourcesConfig,
  MetricsSourcesState,
} from "./types";

const DEFAULT_CONFIG: MetricsSourcesConfig = {
  cacheTtlMs: 60 * 1000,
  scheduleMs: 60 * 1000,
  // Safety: probe only a single node by default to avoid kubectl spawn storms on large clusters.
  maxNodesToProbe: 1,
};

const DEFAULT_SUMMARY: MetricsSourcesState["summary"] = {
  status: "unavailable",
  lastRunAt: null,
  message: "Metrics sources unavailable",
};

const METRICS_INDICATORS = ["# HELP", "# TYPE"] as const;

function normalizeError(error: unknown): string | undefined {
  if (typeof error === "string") return error;
  if (Array.isArray(error)) return error.map((entry) => String(entry)).join("\n");
  if (error == null) return undefined;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function normalizeUrl(url: unknown): string {
  return typeof url === "string" ? url : "";
}

function normalizeNodeName(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export const metricsSourcesConfig = writable<MetricsSourcesConfig>(DEFAULT_CONFIG);
export const metricsSourcesState = writable<Record<string, MetricsSourcesState | undefined>>({});

type MetricsSourcesCheckOptions = {
  force?: boolean;
  skipNodeExporter?: boolean;
  persist?: boolean;
};

type PollController = {
  refCount: number;
  timer: ReturnType<typeof setInterval> | null;
};

const pollControllers = new Map<string, PollController>();
const inFlightChecks = new Map<string, Promise<MetricsSourcesState>>();

function pickNodes(nodes: string[], maxNodes: number): string[] {
  if (maxNodes <= 0) return nodes;
  if (nodes.length <= maxNodes) return nodes;
  return nodes.slice(0, maxNodes);
}

function hasPrometheusText(output: string): boolean {
  return METRICS_INDICATORS.some((indicator) => output.includes(indicator));
}

function resolveStatus(endpoints: MetricsSourceEndpoint[]): MetricsSourceStatus {
  if (endpoints.length === 0 || endpoints.some((endpoint) => endpoint.result === -1)) {
    return "not_found";
  }
  if (endpoints.some((endpoint) => endpoint.result === 0 || endpoint.result === 2)) {
    return "unreachable";
  }
  return "available";
}

function buildMessage(status: MetricsSourceStatus): string {
  if (status === "available") return "✅ Available";
  if (status === "unreachable") return "🟠 Installed but unreachable";
  return "❌ Not found";
}

async function checkKubeletEndpoint(
  clusterId: string,
  path: string,
  nodes: string[],
  maxNodes: number,
) {
  const targetNodes = pickNodes(nodes, maxNodes);

  if (nodes.length === 0) {
    return {
      endpoints: [
        {
          url: "",
          result: -1,
          error: "Cluster has no nodes",
        },
      ],
    };
  }

  const results = await Promise.all(
    targetNodes.map(async (nodeName) => {
      const url = `/api/v1/nodes/${nodeName}/proxy${path}`;
      const response = await kubectlRawFront(`get --raw ${url}`, { clusterId });

      if (response.errors.length) {
        return {
          url,
          result: checkResponseStatus(response.errors),
          error: response.errors,
        } as MetricsSourceEndpoint;
      }

      return {
        url,
        result: hasPrometheusText(response.output) ? 1 : 0,
        error: hasPrometheusText(response.output) ? undefined : "Prometheus text not detected",
      } as MetricsSourceEndpoint;
    }),
  );

  return { endpoints: results };
}

function buildCheck(
  id: string,
  title: string,
  endpoints: MetricsSourceEndpoint[],
): MetricsSourceCheck {
  const status = resolveStatus(endpoints);
  return {
    id,
    title,
    status,
    checkedAt: new Date().toISOString(),
    message: buildMessage(status),
    endpoints,
  };
}

function toClusterMetricsChecks(checks: MetricsSourceCheck[]) {
  return {
    endpoints: Object.fromEntries(
      checks.map((check) => [
        check.id.replace(/-/g, "_"),
        {
          title: check.title,
          status: check.message,
          lastSync: check.checkedAt,
          url: check.endpoints[0]?.url,
          error: check.endpoints.find((endpoint) => endpoint.error)?.error,
        },
      ]),
    ),
  };
}

export async function runMetricsSourcesCheck(
  clusterId: string,
  options?: MetricsSourcesCheckOptions,
): Promise<MetricsSourcesState> {
  const config = get(metricsSourcesConfig);
  const persist = options?.persist ?? !options?.skipNodeExporter;
  const currentState = get(metricsSourcesState)[clusterId];
  const requestKey = `${clusterId}:${options?.skipNodeExporter ? "lite" : "full"}`;
  const inFlight = inFlightChecks.get(requestKey);

  if (persist && currentState?.summary.lastRunAt && !options?.force) {
    const cachedUntil = new Date(currentState.summary.lastRunAt).getTime() + config.cacheTtlMs;
    if (Date.now() < cachedUntil) {
      return currentState;
    }
  }

  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    const clusterNodes = await getClusterNodesNames(clusterId);
    const kubeletMetrics = await checkKubeletEndpoint(
      clusterId,
      "/metrics",
      clusterNodes,
      config.maxNodesToProbe,
    );
    const cadvisorMetrics = await checkKubeletEndpoint(
      clusterId,
      "/metrics/cadvisor",
      clusterNodes,
      config.maxNodesToProbe,
    );
    const metricsServer = await checkMetricsServer(clusterId);
    const kubeStateMetrics = await checkKubeStateMetrics(clusterId);

    const kubeletStatus = resolveStatus(kubeletMetrics.endpoints);
    const cadvisorStatus = resolveStatus(cadvisorMetrics.endpoints);
    const kubeletCombinedStatus =
      kubeletStatus === "not_found" || cadvisorStatus === "not_found"
        ? "not_found"
        : kubeletStatus === "unreachable" || cadvisorStatus === "unreachable"
          ? "unreachable"
          : "available";

    const checks: MetricsSourceCheck[] = [
      {
        id: "kubelet-cadvisor",
        title: "Kubelet / cAdvisor",
        status: kubeletCombinedStatus,
        checkedAt: new Date().toISOString(),
        message: buildMessage(kubeletCombinedStatus),
        endpoints: [...kubeletMetrics.endpoints, ...cadvisorMetrics.endpoints],
      },
      buildCheck(
        "metrics-server",
        "metrics-server",
        metricsServer.status.map((entry) => ({
          url: metricsServer.url || "/apis/metrics.k8s.io/v1beta1/nodes",
          result: entry.result,
          error: metricsServer.error,
        })),
      ),
      buildCheck(
        "kube-state-metrics",
        "kube-state-metrics",
        kubeStateMetrics.status.map((entry) => ({
          url: normalizeUrl(kubeStateMetrics.url),
          result: entry.result,
          error: normalizeError(kubeStateMetrics.error),
        })),
      ),
    ];

    if (!options?.skipNodeExporter) {
      const nodeExporter = await checkNodeExporter(clusterId);
      const clusterNodeSet = new Set(
        clusterNodes
          .map((nodeName) => normalizeNodeName(nodeName))
          .filter((nodeName) => nodeName.length > 0),
      );
      const nodeExporterByNode = new Map<string, number>();
      for (const nodeStatus of nodeExporter.status) {
        const normalized = normalizeNodeName(nodeStatus.nodeName);
        if (!normalized) continue;
        const previous = nodeExporterByNode.get(normalized) ?? -1;
        if (nodeStatus.result > previous) {
          nodeExporterByNode.set(normalized, nodeStatus.result);
        }
      }
      const missingNodeExporterNodes = [...clusterNodeSet].filter(
        (nodeName) => !nodeExporterByNode.has(nodeName),
      );
      const degradedNodeExporterNodes = [...nodeExporterByNode.entries()]
        .filter(([, result]) => result !== 1)
        .map(([nodeName]) => nodeName);
      const nodeExporterCoverageErrors = [
        ...missingNodeExporterNodes.map(
          (nodeName) => `No node-exporter pod/metrics for node ${nodeName}`,
        ),
        ...degradedNodeExporterNodes.map(
          (nodeName) => `node-exporter endpoint is unreachable for node ${nodeName}`,
        ),
      ];
      const nodeExporterCoverageEndpoints = [
        ...nodeExporter.status.map((entry) => ({
          url: normalizeUrl(nodeExporter.url),
          result: entry.result,
          error: normalizeError(nodeExporter.errors),
        })),
        ...(nodeExporter.installed
          ? missingNodeExporterNodes.map((nodeName) => ({
              url: normalizeUrl(nodeExporter.url),
              result: 0,
              error: `No node-exporter pod/metrics for node ${nodeName}`,
            }))
          : []),
      ];
      checks.push(
        buildCheck(
          "node-exporter",
          "node-exporter",
          nodeExporterCoverageEndpoints.length > 0
            ? nodeExporterCoverageEndpoints
            : [
                {
                  url: normalizeUrl(nodeExporter.url),
                  result: -1,
                  error: normalizeError(nodeExporter.errors) || "node-exporter not found",
                },
              ],
        ),
      );

      const nodeExporterCheck = checks.find((check) => check.id === "node-exporter");
      if (nodeExporter.installed && nodeExporterCheck && nodeExporterCoverageErrors.length > 0) {
        nodeExporterCheck.status = "unreachable";
        nodeExporterCheck.message = "🟠 Installed but unreachable";
        if (nodeExporterCheck.endpoints.length > 0) {
          const endpoint = nodeExporterCheck.endpoints[0];
          endpoint.error = [endpoint.error, ...nodeExporterCoverageErrors]
            .filter(Boolean)
            .join("; ");
          endpoint.result = 0;
        } else {
          nodeExporterCheck.endpoints = [
            {
              url: normalizeUrl(nodeExporter.url),
              result: 0,
              error: nodeExporterCoverageErrors.join("; "),
            },
          ];
        }
      }
    }

    const unavailableCount = checks.filter((check) => check.status !== "available").length;
    const summaryStatus = unavailableCount === 0 ? "ok" : "degraded";
    const summary: MetricsSourcesState["summary"] = {
      status: summaryStatus,
      lastRunAt: new Date().toISOString(),
      message:
        unavailableCount === 0 ? "All metrics sources available" : "Metrics sources need attention",
    };

    const nextState: MetricsSourcesState = {
      summary,
      checks,
    };

    if (persist) {
      metricsSourcesState.update((state) => ({
        ...state,
        [clusterId]: nextState,
      }));

      await updateClusterCheckPartially(clusterId, {
        metricsChecks: toClusterMetricsChecks(checks),
        metricsSourcesSummary: {
          status: nextState.summary.status,
          availableCount: checks.filter((check) => check.status === "available").length,
          totalCount: checks.length,
          lastRunAt: nextState.summary.lastRunAt,
          message: nextState.summary.message,
        },
      });
    }

    return nextState;
  })().finally(() => {
    if (inFlightChecks.get(requestKey) === request) {
      inFlightChecks.delete(requestKey);
    }
  });

  inFlightChecks.set(requestKey, request);
  return request;
}

function stopMetricsPollTimer(controller: PollController) {
  if (!controller.timer) return;
  clearInterval(controller.timer);
  controller.timer = null;
}

function ensureMetricsPollTimer(clusterId: string, controller: PollController) {
  if (controller.timer || controller.refCount <= 0) return;
  if (!isClusterRuntimePlaneActive(clusterId, "metrics")) return;
  if (!isDashboardFeatureRouteActive(clusterId, { workloads: ["metricssources"] })) return;

  void runMetricsSourcesCheck(clusterId, { force: false });
  const { scheduleMs } = get(metricsSourcesConfig);

  controller.timer = setInterval(() => {
    void runMetricsSourcesCheck(clusterId, { force: true });
  }, scheduleMs);
}

clusterRuntimeContext.subscribe(() => {
  for (const [clusterId, controller] of pollControllers.entries()) {
    if (
      isClusterRuntimePlaneActive(clusterId, "metrics") &&
      isDashboardFeatureRouteActive(clusterId, { workloads: ["metricssources"] })
    ) {
      ensureMetricsPollTimer(clusterId, controller);
    } else {
      stopMetricsPollTimer(controller);
    }
  }
});

activeDashboardRoute.subscribe(() => {
  for (const [clusterId, controller] of pollControllers.entries()) {
    if (
      isClusterRuntimePlaneActive(clusterId, "metrics") &&
      isDashboardFeatureRouteActive(clusterId, { workloads: ["metricssources"] })
    ) {
      ensureMetricsPollTimer(clusterId, controller);
      continue;
    }
    stopMetricsPollTimer(controller);
  }
});

export function startMetricsSourcesPolling(clusterId: string) {
  if (!clusterId) return;

  const existing = pollControllers.get(clusterId);
  if (existing) {
    existing.refCount += 1;
    ensureMetricsPollTimer(clusterId, existing);
    return;
  }

  const controller: PollController = {
    refCount: 1,
    timer: null,
  };
  pollControllers.set(clusterId, controller);
  ensureMetricsPollTimer(clusterId, controller);
}

export function stopMetricsSourcesPolling(clusterId: string) {
  const controller = pollControllers.get(clusterId);
  if (!controller) return;
  controller.refCount -= 1;
  if (controller.refCount > 0) return;
  stopMetricsPollTimer(controller);
  pollControllers.delete(clusterId);
}

export function stopAllMetricsSourcesPolling() {
  for (const [clusterId, controller] of pollControllers.entries()) {
    stopMetricsPollTimer(controller);
    pollControllers.delete(clusterId);
  }
}

export function markMetricsSourcesUnavailable(clusterId: string, reason: string) {
  const nextState: MetricsSourcesState = {
    summary: {
      ...DEFAULT_SUMMARY,
      message: reason,
    },
    checks: [],
  };

  metricsSourcesState.update((state) => ({
    ...state,
    [clusterId]: nextState,
  }));
}
