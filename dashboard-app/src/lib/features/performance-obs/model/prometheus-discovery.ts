/**
 * Locate a Prometheus-compatible HTTP service on the cluster so we can run
 * PromQL queries through the Kubernetes service proxy without requiring the
 * user to set up port-forwarding manually.
 *
 * Chart-to-service reference:
 *   - kube-prometheus-stack: svc/<release>-prometheus:9090 in release ns
 *     https://github.com/prometheus-community/helm-charts/blob/main/charts/kube-prometheus-stack/templates/prometheus/service.yaml
 *   - prometheus-operator: svc/prometheus-operated:9090 (operator-managed)
 *     https://github.com/prometheus-operator/prometheus-operator
 *   - prometheus community chart: svc/prometheus-server:80 in release ns
 *     https://github.com/prometheus-community/helm-charts/tree/main/charts/prometheus
 *
 * All three expose the standard Prometheus HTTP API at /api/v1/*, which is
 * what we need for range and instant queries.
 */

import { kubectlJson } from "$shared/api/kubectl-proxy";

export type PrometheusEndpoint = {
  namespace: string;
  service: string;
  port: number;
  /** Helm chart or deployment style this endpoint was matched against. */
  flavor: "kube-prometheus-stack" | "prometheus-operator" | "prometheus-server" | "custom";
};

type ServiceItem = {
  metadata?: { name?: string; namespace?: string };
  spec?: { ports?: Array<{ name?: string; port?: number }> };
};

const CANDIDATES: Array<{
  serviceSuffix: string;
  portName: string;
  fallbackPort: number;
  flavor: PrometheusEndpoint["flavor"];
}> = [
  // kube-prometheus-stack installs svc named <release>-prometheus; match any
  // service whose name ends with -prometheus exposing the web port.
  {
    serviceSuffix: "-prometheus",
    portName: "http-web",
    fallbackPort: 9090,
    flavor: "kube-prometheus-stack",
  },
  // prometheus-operator headless service
  {
    serviceSuffix: "prometheus-operated",
    portName: "web",
    fallbackPort: 9090,
    flavor: "prometheus-operator",
  },
  // community prometheus chart
  {
    serviceSuffix: "prometheus-server",
    portName: "http",
    fallbackPort: 80,
    flavor: "prometheus-server",
  },
];

function pickPort(service: ServiceItem, candidatePort: string, fallback: number): number {
  const named = service.spec?.ports?.find((p) => p.name === candidatePort && p.port);
  if (named?.port) return named.port;
  const first = service.spec?.ports?.[0]?.port;
  return first ?? fallback;
}

/**
 * Scan services across all namespaces for a Prometheus-compatible endpoint.
 * Returns the first match according to `CANDIDATES` preference order.
 */
export async function discoverPrometheusService(
  clusterId: string,
): Promise<PrometheusEndpoint | null> {
  const result = await kubectlJson<{ items?: ServiceItem[] }>(
    "get services --all-namespaces --request-timeout=10s",
    { clusterId },
  );
  if (typeof result === "string") return null;
  const services = result.items ?? [];

  for (const candidate of CANDIDATES) {
    const match = services.find((svc) => {
      const name = svc.metadata?.name ?? "";
      if (candidate.serviceSuffix.startsWith("-")) {
        return name.endsWith(candidate.serviceSuffix) && name !== candidate.serviceSuffix;
      }
      return name === candidate.serviceSuffix;
    });
    if (match?.metadata?.name && match.metadata.namespace) {
      return {
        namespace: match.metadata.namespace,
        service: match.metadata.name,
        port: pickPort(match, candidate.portName, candidate.fallbackPort),
        flavor: candidate.flavor,
      };
    }
  }
  return null;
}
