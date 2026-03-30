export const METRICS_BANNER_SUMMARY =
  "CPU and memory metrics are unavailable. Install metrics-server or configure Prometheus/kubelet metrics.";

export const METRICS_BANNER_DISK_NOTE =
  "Disk values can still be provided by node-exporter or kubelet disk metrics.";

export const METRICS_BANNER_PIPELINE =
  "Metrics sources are available, but CPU and memory data could not be read from the APIs. Check RBAC, API aggregation, and metrics endpoint access.";

export const METRICS_BANNER_CTA = "Open Metrics Sources";

export function buildMetricsSourcesHref(clusterId: string): string {
  return `/dashboard/clusters/${encodeURIComponent(clusterId)}?workload=metricssources`;
}

export type MetricsEndpointStatus = { status?: string };
export type MetricsSourceCheckStatus = {
  id: string;
  status: "available" | "unreachable" | "not_found";
};

type MetricsRecommendationContext = "pods" | "nodes";

export function parseMetricsEndpointSeverity(
  status: string | undefined,
): "ok" | "warning" | "critical" | "unknown" {
  if (!status) return "unknown";
  const normalized = status.toLowerCase();
  if (normalized.includes("available") || normalized.includes("🟢") || normalized.includes("✅")) {
    return "ok";
  }
  if (normalized.includes("timeout") || normalized.includes("⏳")) return "warning";
  if (
    normalized.includes("unreachable") ||
    normalized.includes("not found") ||
    normalized.includes("❌")
  ) {
    return "critical";
  }
  return "unknown";
}

export function hasCoreMetricsSourcesUnavailable(
  endpoints: Partial<Record<string, MetricsEndpointStatus>> | undefined,
): boolean {
  if (!endpoints) return false;
  const metricsServer = parseMetricsEndpointSeverity(endpoints.metrics_server?.status);
  const kubelet = parseMetricsEndpointSeverity(endpoints.kubelet?.status);
  return (
    metricsServer === "critical" ||
    kubelet === "critical" ||
    metricsServer === "warning" ||
    kubelet === "warning"
  );
}

export function hasCoreMetricsSourcesUnavailableByChecks(
  checks: MetricsSourceCheckStatus[] | undefined,
): boolean {
  if (!checks || checks.length === 0) return false;
  const metricsServer = checks.find((check) => check.id === "metrics-server");
  const kubeletCadvisor = checks.find((check) => check.id === "kubelet-cadvisor");
  const metricsServerUnavailable =
    metricsServer?.status === "not_found" || metricsServer?.status === "unreachable";
  const kubeletUnavailable =
    kubeletCadvisor?.status === "not_found" || kubeletCadvisor?.status === "unreachable";
  return metricsServerUnavailable || kubeletUnavailable;
}

export function buildMetricsRecommendationText(
  checks: MetricsSourceCheckStatus[] | undefined,
  context: MetricsRecommendationContext,
): string | null {
  if (!checks || checks.length === 0) return null;

  const metricsServer = checks.find((check) => check.id === "metrics-server");
  const nodeExporter = checks.find((check) => check.id === "node-exporter");

  const recommendations: string[] = [];
  const isUnavailable = (status: MetricsSourceCheckStatus["status"] | undefined) =>
    status === "not_found" || status === "unreachable";

  if (isUnavailable(metricsServer?.status)) {
    recommendations.push("Install metrics-server for CPU and memory metrics.");
  }
  if (context === "nodes" && isUnavailable(nodeExporter?.status)) {
    recommendations.push("Install node-exporter for host-level node metrics.");
  }

  if (recommendations.length === 0) return null;
  return recommendations.join(" ");
}
