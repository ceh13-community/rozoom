import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import { resolveClusterRuntimeBudgetForCluster } from "$shared/lib/cluster-runtime-manager";
import { createRequestCoalescer } from "$shared/lib/request-coalescer";

export type ApiserverMetricsResult = {
  output: string;
  error: string | null;
};

const APISERVER_METRICS_CACHE_TTL_MS = 60 * 1000;
const APISERVER_METRICS_REUSE_ONLY_TTL_MS = 5 * 60 * 1000;
const APISERVER_METRICS_EAGER_TTL_MS = 15 * 1000;

const apiserverMetricsRequestCoalescer = createRequestCoalescer();
const apiserverMetricsCache = new Map<
  string,
  { fetchedAt: number; result: ApiserverMetricsResult }
>();

async function loadApiserverMetrics(
  clusterId: string,
  requestTimeout = "10s",
): Promise<ApiserverMetricsResult> {
  const response = await kubectlRawArgsFront(
    ["get", "--raw", "/metrics", `--request-timeout=${requestTimeout}`],
    { clusterId },
  );

  if (response.errors || response.code !== 0) {
    return {
      output: "",
      error: response.errors || "Failed to fetch apiserver metrics.",
    };
  }

  return {
    output: response.output,
    error: null,
  };
}

function resolveFetchPolicy(
  clusterId: string,
  options?: { force?: boolean; cacheTtlMs?: number; requestTimeout?: string },
) {
  const runtimeBudget = resolveClusterRuntimeBudgetForCluster(clusterId);
  const requestedTtl = options?.cacheTtlMs ?? APISERVER_METRICS_CACHE_TTL_MS;

  if (runtimeBudget.metricsReadPolicy === "reuse_only") {
    return {
      force: false,
      cacheTtlMs: Math.max(requestedTtl, APISERVER_METRICS_REUSE_ONLY_TTL_MS),
      requestTimeout: options?.requestTimeout,
    };
  }

  if (runtimeBudget.metricsReadPolicy === "eager") {
    return {
      force: options?.force === true,
      cacheTtlMs: Math.min(requestedTtl, APISERVER_METRICS_EAGER_TTL_MS),
      requestTimeout: options?.requestTimeout,
    };
  }

  return {
    force: options?.force === true,
    cacheTtlMs: requestedTtl,
    requestTimeout: options?.requestTimeout,
  };
}

export async function fetchApiserverMetrics(
  clusterId: string,
  options?: { force?: boolean; cacheTtlMs?: number; requestTimeout?: string },
): Promise<ApiserverMetricsResult> {
  const effectiveOptions = resolveFetchPolicy(clusterId, options);
  const cacheTtlMs = effectiveOptions.cacheTtlMs;
  const cached = apiserverMetricsCache.get(clusterId);
  if (!effectiveOptions.force && cached && Date.now() - cached.fetchedAt < cacheTtlMs) {
    return cached.result;
  }

  const requestKey = `apiserver-metrics:${clusterId}:${effectiveOptions.requestTimeout ?? "10s"}`;
  const result = await apiserverMetricsRequestCoalescer.run(requestKey, async () => {
    const next = await loadApiserverMetrics(clusterId, effectiveOptions.requestTimeout);
    apiserverMetricsCache.set(clusterId, { fetchedAt: Date.now(), result: next });
    return next;
  });

  return result;
}

export function resetApiserverMetricsCache() {
  apiserverMetricsCache.clear();
  apiserverMetricsRequestCoalescer.clear();
}

export function getApiserverMetricsCacheSnapshot(clusterId: string) {
  return apiserverMetricsCache.get(clusterId) ?? null;
}
