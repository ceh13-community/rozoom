/**
 * Thin Prometheus query client that routes HTTP calls through the
 * Kubernetes service proxy so no port-forward is required.
 *
 * Kubernetes service proxy:
 *   /api/v1/namespaces/<ns>/services/<svc>:<port>/proxy/<path>
 *   https://kubernetes.io/docs/tasks/extend-kubernetes/http-proxy-access-api/
 *
 * Prometheus HTTP API:
 *   https://prometheus.io/docs/prometheus/latest/querying/api/
 */

import { kubectlJson } from "$shared/api/kubectl-proxy";
import type { PrometheusEndpoint } from "./prometheus-discovery";

type PromQueryResult = {
  status?: string;
  data?: {
    resultType?: string;
    result?: Array<{
      metric?: Record<string, string>;
      value?: [number, string];
      values?: Array<[number, string]>;
    }>;
  };
  errorType?: string;
  error?: string;
};

function buildProxyPath(endpoint: PrometheusEndpoint, apiPath: string, query: string): string {
  // Prometheus at /api/v1/query accepts ?query=<PromQL>. URL-encode the query
  // because PromQL contains characters (space, =, /, {, ,) that must be safe
  // for the proxy hop.
  const params = new URLSearchParams({ query });
  return `/api/v1/namespaces/${endpoint.namespace}/services/${endpoint.service}:${endpoint.port}/proxy/api/v1/${apiPath}?${params.toString()}`;
}

/**
 * Run an instant PromQL query. Returns the parsed response or null when the
 * call fails (service proxy not reachable, Prometheus returned non-success,
 * malformed JSON).
 */
export async function instantQuery(
  clusterId: string,
  endpoint: PrometheusEndpoint,
  promql: string,
): Promise<PromQueryResult | null> {
  const path = buildProxyPath(endpoint, "query", promql);
  const raw = await kubectlJson<PromQueryResult>(
    `get --raw=${JSON.stringify(path)} --request-timeout=15s`,
    { clusterId },
  );
  if (typeof raw === "string") return null;
  if (raw.status !== "success") return null;
  return raw;
}

/**
 * Extract scalar number values grouped by arbitrary label set. Handy for the
 * classic "sum by (x, y) (...)" shape where each series has one sample.
 */
export function extractScalars(
  result: PromQueryResult | null,
  labels: string[],
): Array<{ key: string; tags: Record<string, string>; value: number }> {
  if (!result?.data?.result) return [];
  const out: Array<{ key: string; tags: Record<string, string>; value: number }> = [];
  for (const series of result.data.result) {
    const value = series.value?.[1];
    if (value === undefined) continue;
    const num = parseFloat(value);
    if (!Number.isFinite(num)) continue;
    const tags: Record<string, string> = {};
    for (const label of labels) {
      tags[label] = series.metric?.[label] ?? "";
    }
    const key = labels.map((l) => tags[l] || "-").join("/");
    out.push({ key, tags, value: num });
  }
  return out;
}
