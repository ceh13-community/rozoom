import { discoverPrometheusService } from "$shared/api/discover-prometheus";
import { checkKubelet } from "../check-kubelet";
import { checkMetricsServer } from "../check-metrics-server";
import { checkNodeExporter } from "../check-node-exporter";
import {
  getFeatureCapability,
  markFeatureCapability,
  shouldSkipFeatureProbe,
} from "../../model/feature-capability-cache";

export type MetricsSourceId = "api" | "metrics_server" | "node_exporter" | "prometheus";

export type MetricsSourceCapability = {
  id: MetricsSourceId;
  title: string;
  available: boolean;
  checkedAt: string;
  reason?: string;
  reasonCategory?:
    | "unsupported"
    | "forbidden"
    | "unreachable"
    | "unavailable"
    | "misconfigured"
    | "unknown";
  recommendation?: string;
};

export type MetricsSourceProbeInputs = {
  kubelet: Awaited<ReturnType<typeof checkKubelet>> | Error;
  metricsServer: Awaited<ReturnType<typeof checkMetricsServer>> | Error;
  nodeExporter: Awaited<ReturnType<typeof checkNodeExporter>> | Error;
  prometheusService: Awaited<ReturnType<typeof discoverPrometheusService>> | null;
};

export type MetricsResolutionQuality = "high" | "medium" | "low";

export type MetricsSourceAttempt = {
  source: MetricsSourceId;
  status: "success" | "failed" | "skipped";
  latencyMs: number;
  message?: string;
};

export type MetricsFlowTrace = {
  metric: "cpu_memory" | "disk";
  resolvedFrom: MetricsSourceId | null;
  quality: MetricsResolutionQuality;
  attempts: MetricsSourceAttempt[];
  missingSources: MetricsSourceId[];
  recommendations: string[];
};

const CAPABILITIES_TTL_MS = 30_000;

const capabilityCache = new Map<
  string,
  {
    ts: number;
    value: MetricsSourceCapability[];
  }
>();

const SOURCE_TITLES: Record<MetricsSourceId, string> = {
  api: "Kubelet API",
  metrics_server: "metrics-server",
  node_exporter: "node-exporter",
  prometheus: "Prometheus",
};

const SOURCE_RECOMMENDATIONS: Record<MetricsSourceId, string> = {
  api: "Verify kubelet API access via apiserver proxy and node RBAC permissions.",
  metrics_server:
    "Install metrics-server (Helm chart: kubernetes-sigs/metrics-server) and verify `kubectl top nodes`.",
  node_exporter:
    "Install node-exporter DaemonSet (or kube-prometheus-stack) to expose host-level metrics.",
  prometheus:
    "Install Prometheus (recommended: kube-prometheus-stack) and expose the service for proxy queries.",
};

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

function fromStatusResult(results: Array<{ result: number }> | undefined): boolean {
  return Array.isArray(results) && results.some((entry) => entry.result === 1);
}

function buildCapability(
  id: MetricsSourceId,
  available: boolean,
  reason?: string,
): MetricsSourceCapability {
  const normalizedReason = normalizeCapabilityReason(reason);

  return {
    id,
    title: SOURCE_TITLES[id],
    available,
    checkedAt: new Date().toISOString(),
    ...(reason ? { reason } : {}),
    ...(normalizedReason ? { reasonCategory: normalizedReason } : {}),
    ...(available ? {} : { recommendation: SOURCE_RECOMMENDATIONS[id] }),
  };
}

function normalizeCapabilityReason(reason?: string): MetricsSourceCapability["reasonCategory"] {
  if (!reason) return undefined;
  const normalized = reason.toLowerCase();

  if (
    normalized.includes("doesn't have a resource type") ||
    normalized.includes("no matches for kind") ||
    normalized.includes("not installed")
  ) {
    return "unsupported";
  }
  if (
    normalized.includes("forbidden") ||
    normalized.includes("unauthorized") ||
    normalized.includes("permission")
  ) {
    return "forbidden";
  }
  if (
    normalized.includes("no route to host") ||
    normalized.includes("connection refused") ||
    normalized.includes("unable to connect") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("unreachable")
  ) {
    return "unreachable";
  }
  if (
    normalized.includes("serviceunavailable") ||
    normalized.includes("service unavailable") ||
    normalized.includes("metrics api not available") ||
    normalized.includes("no endpoints available") ||
    normalized.includes("was not discovered")
  ) {
    return "unavailable";
  }
  if (normalized.includes("exit code 127") || normalized.includes("command terminated")) {
    return "misconfigured";
  }
  return "unknown";
}

function featureIdForSource(source: MetricsSourceId) {
  return `metrics-source:${source}`;
}

function buildCapabilityFromFeatureCache(
  clusterId: string,
  id: MetricsSourceId,
): MetricsSourceCapability | null {
  const cached = getFeatureCapability(clusterId, featureIdForSource(id));
  if (!cached) return null;
  return buildCapability(id, cached.status === "available", cached.reason);
}

function persistCapability(clusterId: string, capability: MetricsSourceCapability) {
  markFeatureCapability(clusterId, featureIdForSource(capability.id), {
    status: capability.available ? "available" : (capability.reasonCategory ?? "unknown"),
    reason: capability.reason,
  });
  return capability;
}

export async function getMetricsSourceCapabilities(
  clusterId: string,
  options?: { force?: boolean; probes?: MetricsSourceProbeInputs },
): Promise<MetricsSourceCapability[]> {
  const cached = capabilityCache.get(clusterId);

  if (!options?.force && cached && Date.now() - cached.ts <= CAPABILITIES_TTL_MS) {
    return cached.value;
  }

  let probes: MetricsSourceProbeInputs;
  if (options?.probes) {
    probes = options.probes;
  } else {
    const cachedApi = shouldSkipFeatureProbe(clusterId, featureIdForSource("api"), {
      statuses: ["unsupported", "forbidden", "unreachable", "unavailable", "misconfigured"],
    })
      ? buildCapabilityFromFeatureCache(clusterId, "api")
      : null;
    const cachedMetricsServer = shouldSkipFeatureProbe(
      clusterId,
      featureIdForSource("metrics_server"),
      {
        statuses: ["unsupported", "forbidden", "unreachable", "unavailable", "misconfigured"],
      },
    )
      ? buildCapabilityFromFeatureCache(clusterId, "metrics_server")
      : null;
    const cachedNodeExporter = shouldSkipFeatureProbe(
      clusterId,
      featureIdForSource("node_exporter"),
      {
        statuses: ["unsupported", "forbidden", "unreachable", "unavailable", "misconfigured"],
      },
    )
      ? buildCapabilityFromFeatureCache(clusterId, "node_exporter")
      : null;
    const cachedPrometheus = shouldSkipFeatureProbe(clusterId, featureIdForSource("prometheus"), {
      statuses: ["unsupported", "forbidden", "unreachable", "unavailable", "misconfigured"],
    })
      ? buildCapabilityFromFeatureCache(clusterId, "prometheus")
      : null;
    const probeResults = await Promise.all([
      cachedApi
        ? Promise.resolve(new Error(cachedApi.reason ?? "cached"))
        : checkKubelet(clusterId).catch((error: unknown) => toError(error)),
      cachedMetricsServer
        ? Promise.resolve(new Error(cachedMetricsServer.reason ?? "cached"))
        : checkMetricsServer(clusterId).catch((error: unknown) => toError(error)),
      cachedNodeExporter
        ? Promise.resolve(new Error(cachedNodeExporter.reason ?? "cached"))
        : checkNodeExporter(clusterId).catch((error: unknown) => toError(error)),
      cachedPrometheus
        ? Promise.resolve(null)
        : discoverPrometheusService(clusterId).catch(() => null),
    ] as const);
    const [kubelet, metricsServer, nodeExporter, prometheusService] = probeResults;
    probes = { kubelet, metricsServer, nodeExporter, prometheusService };
  }

  const capabilities: MetricsSourceCapability[] = [
    probes.kubelet instanceof Error
      ? buildCapability("api", false, probes.kubelet.message)
      : buildCapability(
          "api",
          fromStatusResult(probes.kubelet.status),
          probes.kubelet.error || undefined,
        ),
    probes.metricsServer instanceof Error
      ? buildCapability("metrics_server", false, probes.metricsServer.message)
      : buildCapability(
          "metrics_server",
          fromStatusResult(probes.metricsServer.status),
          probes.metricsServer.error || undefined,
        ),
    probes.nodeExporter instanceof Error
      ? buildCapability("node_exporter", false, probes.nodeExporter.message)
      : buildCapability(
          "node_exporter",
          fromStatusResult(probes.nodeExporter.status),
          Array.isArray(probes.nodeExporter.errors)
            ? probes.nodeExporter.errors.join("; ")
            : undefined,
        ),
    buildCapability(
      "prometheus",
      Boolean(probes.prometheusService),
      probes.prometheusService ? undefined : "Prometheus service was not discovered",
    ),
  ].map((capability) => persistCapability(clusterId, capability));

  capabilityCache.set(clusterId, { ts: Date.now(), value: capabilities });

  return capabilities;
}

export function getMissingSourceIds(capabilities: MetricsSourceCapability[]): MetricsSourceId[] {
  return capabilities.filter((entry) => !entry.available).map((entry) => entry.id);
}

export function buildRecommendations(capabilities: MetricsSourceCapability[]): string[] {
  return capabilities
    .filter((entry) => !entry.available && typeof entry.recommendation === "string")
    .map((entry) => entry.recommendation as string);
}

export function resetMetricsSourceCapabilitiesCache() {
  capabilityCache.clear();
}
