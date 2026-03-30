import { error as logError } from "@tauri-apps/plugin-log";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import {
  isCommandUnavailableProbeError,
  isExpectedClusterProbeError,
} from "$shared/lib/runtime-probe-errors";
import type {
  EtcdEndpointHealth,
  EtcdEndpointStatus,
  EtcdHealthReport,
  EtcdHealthStatus,
  EtcdMetricRate,
  EtcdMetricSample,
} from "../model/types";

const ETCD_NAMESPACE = "kube-system";
const ETCD_LABELS = ["component=etcd", "k8s-app=etcd", "app=etcd", "app.kubernetes.io/name=etcd"];
const ETCD_PORT = 2379;
const HEALTH_CACHE_MS = 60 * 1000;
const METRICS_CACHE_MS = 10 * 60 * 1000;
const HEALTH_WARN_TAKE_MS = 100;
const RAFT_INDEX_WARNING_DIFF = 500;
const RAFT_INDEX_CRITICAL_DIFF = 2000;
const DB_SIZE_WARNING_BYTES = 2 * 1024 * 1024 * 1024;
const DB_SIZE_CRITICAL_BYTES = 4 * 1024 * 1024 * 1024;
const LEADER_CHANGES_WARN_PER_HOUR = 5;
const LEADER_CHANGES_CRITICAL_PER_HOUR = 15;
const DB_GROWTH_WARN_BYTES_PER_HOUR = 512 * 1024 * 1024;
const DB_GROWTH_CRITICAL_BYTES_PER_HOUR = 1024 * 1024 * 1024;
const ETCDCTL_CERT_PATH = "/etc/kubernetes/pki/etcd";

const cachedHealth = new Map<string, { data: EtcdHealthReport; fetchedAt: number }>();
const cachedMetrics = new Map<string, { data: EtcdMetricSample[]; fetchedAt: number }>();
const metricsHistory = new Map<
  string,
  { capturedAt: number; totals: { leaderChanges?: number; dbSizeBytes?: number } }
>();

type EtcdTlsConfig = {
  caCertPath: string;
  certPath: string;
  keyPath: string;
};

type EtcdPodInfo = {
  name: string;
  ip?: string;
  tlsConfig?: EtcdTlsConfig;
};

async function logEtcdProbeErrorIfUnexpected(message: string) {
  if (isExpectedClusterProbeError(message) || isCommandUnavailableProbeError(message)) return;
  await logError(message);
}

type EtcdStatusRaw = {
  Endpoint?: string;
  Status?: {
    version?: string;
    dbSize?: number;
    dbSizeBytes?: number;
    leader?: number;
    raftIndex?: number;
    raftTerm?: number;
    raftAppliedIndex?: number;
    header?: {
      member_id?: number;
      memberId?: number;
      memberID?: number;
    };
  };
};

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isPodList(value: unknown): value is {
  items?: Array<{
    metadata?: { name?: string; labels?: Record<string, string> };
    status?: { podIP?: string; phase?: string };
    spec?: {
      containers?: Array<{
        command?: string[];
        args?: string[];
      }>;
    };
  }>;
} {
  if (!value || typeof value !== "object") return false;
  if (!("items" in value)) return false;
  const list = value as { items?: unknown };
  return Array.isArray(list.items);
}

function extractFlagValue(args: string[], flag: string): string | undefined {
  const prefix = `${flag}=`;
  for (const arg of args) {
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
  }
  return undefined;
}

function extractEtcdTlsConfig(item: {
  spec?: {
    containers?: Array<{
      command?: string[];
      args?: string[];
    }>;
  };
}): EtcdTlsConfig | undefined {
  const primaryContainer = item.spec?.containers?.[0];
  const cliArgs = [...(primaryContainer?.command ?? []), ...(primaryContainer?.args ?? [])];
  const caCertPath = extractFlagValue(cliArgs, "--trusted-ca-file");
  const certPath = extractFlagValue(cliArgs, "--cert-file");
  const keyPath = extractFlagValue(cliArgs, "--key-file");
  if (!caCertPath || !certPath || !keyPath) {
    return undefined;
  }
  return {
    caCertPath,
    certPath,
    keyPath,
  };
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseDurationToMs(duration: string | undefined): number | undefined {
  if (!duration) return undefined;
  const match = duration.trim().match(/^([\d.]+)\s*(ns|us|µs|ms|s)?$/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = match[2] ? match[2].toLowerCase() : "ms";
  if (!Number.isFinite(value)) return undefined;
  switch (unit) {
    case "s":
      return value * 1000;
    case "ms":
      return value;
    case "us":
    case "µs":
      return value / 1000;
    case "ns":
      return value / 1_000_000;
    default:
      return value;
  }
}

export function parseEtcdHealthOutput(output: string): EtcdEndpointHealth[] {
  if (!output.trim()) return [];
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(
        /^(?<endpoint>\S+)\s+is\s+(?<status>healthy|unhealthy)\b(?:.*took\s*=\s*(?<took>\S+))?/i,
      );
      const endpoint = match?.groups?.endpoint ?? line.split(" ")[0];
      const isHealthy = (match?.groups?.status ?? "").toLowerCase() === "healthy";
      const tookMs = parseDurationToMs(match?.groups?.took);
      const error = isHealthy ? undefined : line.replace(endpoint, "").trim();

      return {
        endpoint,
        ok: isHealthy,
        tookMs,
        error: error || undefined,
      };
    });
}

export function parseEtcdStatusOutput(output: string): EtcdEndpointStatus[] {
  const trimmed = output.trim();
  if (!trimmed) return [];

  const parsed = parseJson(trimmed) as EtcdStatusRaw[] | { Statuses?: EtcdStatusRaw[] } | null;
  const entries = Array.isArray(parsed) ? parsed : (parsed?.Statuses ?? []);

  return entries.map((entry) => {
    const status = entry.Status ?? {};
    const endpoint = entry.Endpoint ?? "unknown";
    const leaderId = toNumber(status.leader);
    const memberId =
      toNumber(status.header?.member_id) ??
      toNumber(status.header?.memberId) ??
      toNumber(status.header?.memberID);
    const isLeader =
      leaderId !== undefined && memberId !== undefined ? leaderId === memberId : undefined;

    return {
      endpoint,
      version: status.version,
      dbSizeBytes: toNumber(status.dbSize ?? status.dbSizeBytes),
      raftIndex: toNumber(status.raftIndex ?? status.raftAppliedIndex),
      raftTerm: toNumber(status.raftTerm),
      leaderId,
      isLeader,
    };
  });
}

export function parseEtcdMetrics(output: string, endpoint: string): EtcdMetricSample | null {
  if (!output.trim()) return null;
  const metrics = new Map<string, number>();
  const targetMetrics = [
    "etcd_server_has_leader",
    "etcd_server_leader_changes_seen_total",
    "etcd_debugging_mvcc_db_total_size_in_bytes",
    "etcd_server_proposals_committed_total",
  ];

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(
      /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{[^}]*\})?\s+([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/,
    );
    if (!match) continue;
    const name = match[1];
    if (!targetMetrics.includes(name)) continue;
    const value = Number(match[2]);
    if (Number.isFinite(value)) {
      metrics.set(name, value);
    }
  }

  if (!metrics.size) return null;

  return {
    endpoint,
    hasLeader: metrics.get("etcd_server_has_leader"),
    leaderChangesTotal: metrics.get("etcd_server_leader_changes_seen_total"),
    dbSizeBytes: metrics.get("etcd_debugging_mvcc_db_total_size_in_bytes"),
    proposalsCommittedTotal: metrics.get("etcd_server_proposals_committed_total"),
    sampledAt: Date.now(),
  };
}

function extractEtcdPods(list: {
  items?: Array<{
    metadata?: { name?: string };
    status?: { podIP?: string; phase?: string };
    spec?: {
      containers?: Array<{
        command?: string[];
        args?: string[];
      }>;
    };
  }>;
}): EtcdPodInfo[] {
  return (
    list.items
      ?.filter((item) => (item.status?.phase ? item.status.phase === "Running" : true))
      .map((item) => ({
        name: item.metadata?.name ?? "",
        ip: item.status?.podIP,
        tlsConfig: extractEtcdTlsConfig(item),
      }))
      .filter((pod) => pod.name) ?? []
  );
}

function isEtcdPodCandidate(item: {
  metadata?: { name?: string; labels?: Record<string, string> };
}): boolean {
  const name = item.metadata?.name?.toLowerCase() ?? "";
  const labels = item.metadata?.labels
    ? Object.values(item.metadata.labels).join(" ").toLowerCase()
    : "";
  return name.includes("etcd") || labels.includes("etcd");
}

async function loadEtcdPods(clusterId: string): Promise<EtcdPodInfo[]> {
  for (const label of ETCD_LABELS) {
    const response = await kubectlRawFront(`get pods -n ${ETCD_NAMESPACE} -l ${label} -o json`, {
      clusterId,
      source: "check-etcd-health:discover-pods",
    });
    const parsed = parseJson(response.output);
    if (!isPodList(parsed)) continue;
    const pods = extractEtcdPods(parsed);
    if (pods.length) return pods;
  }

  const response = await kubectlRawFront(`get pods -n ${ETCD_NAMESPACE} -o json`, {
    clusterId,
    source: "check-etcd-health:discover-pods-fallback",
  });
  const parsed = parseJson(response.output);
  if (!isPodList(parsed)) return [];
  const filtered = {
    items: parsed.items?.filter(isEtcdPodCandidate),
  };
  return extractEtcdPods(filtered);
}

function buildEtcdctlCommand(
  base: string,
  endpoints: string,
  command: string,
  tlsConfig?: EtcdTlsConfig,
): string {
  const effectiveTlsConfig = tlsConfig ?? {
    caCertPath: `${ETCDCTL_CERT_PATH}/ca.crt`,
    certPath: `${ETCDCTL_CERT_PATH}/healthcheck-client.crt`,
    keyPath: `${ETCDCTL_CERT_PATH}/healthcheck-client.key`,
  };
  const certs = `--cacert=${effectiveTlsConfig.caCertPath} --cert=${effectiveTlsConfig.certPath} --key=${effectiveTlsConfig.keyPath}`;
  return `${base} --endpoints=${endpoints} ${certs} ${command}`;
}

function buildStatusSummary(
  health: EtcdEndpointHealth[],
  statuses: EtcdEndpointStatus[],
  metrics: EtcdMetricSample[],
  metricRates: EtcdMetricRate,
  errorMessage?: string,
): { status: EtcdHealthStatus; warnings: string[] } {
  const warnings: string[] = [];
  let isCritical = false;

  if (errorMessage) {
    isCritical = true;
    warnings.push(errorMessage);
  }

  if (health.some((item) => !item.ok)) {
    isCritical = true;
    warnings.push("One or more etcd endpoints are unhealthy.");
  }

  const slowEndpoints = health.filter((item) => (item.tookMs ?? 0) > HEALTH_WARN_TAKE_MS);
  if (slowEndpoints.length) {
    warnings.push("Some etcd endpoints have slow health checks.");
  }

  const leaderIds = statuses
    .map((status) => status.leaderId)
    .filter((value) => value !== undefined);
  const hasLeader = leaderIds.some((value) => value > 0);
  if (!hasLeader && statuses.length) {
    isCritical = true;
    warnings.push("No etcd leader detected.");
  }

  const raftIndexes = statuses
    .map((status) => status.raftIndex)
    .filter((value): value is number => value !== undefined);
  if (raftIndexes.length >= 2) {
    const maxIndex = Math.max(...raftIndexes);
    const minIndex = Math.min(...raftIndexes);
    const diff = maxIndex - minIndex;
    if (diff >= RAFT_INDEX_CRITICAL_DIFF) {
      isCritical = true;
      warnings.push("Large Raft index divergence detected.");
    } else if (diff >= RAFT_INDEX_WARNING_DIFF) {
      warnings.push("Raft index divergence detected.");
    }
  }

  const maxDbSize = Math.max(
    0,
    ...statuses.map((status) => status.dbSizeBytes ?? 0),
    ...metrics.map((sample) => sample.dbSizeBytes ?? 0),
  );
  if (maxDbSize >= DB_SIZE_CRITICAL_BYTES) {
    isCritical = true;
    warnings.push("etcd database size is above critical threshold.");
  } else if (maxDbSize >= DB_SIZE_WARNING_BYTES) {
    warnings.push("etcd database size is above warning threshold.");
  }

  if (metricRates.leaderChangesPerHour !== undefined) {
    if (metricRates.leaderChangesPerHour >= LEADER_CHANGES_CRITICAL_PER_HOUR) {
      isCritical = true;
      warnings.push("High etcd leader change rate detected.");
    } else if (metricRates.leaderChangesPerHour >= LEADER_CHANGES_WARN_PER_HOUR) {
      warnings.push("Elevated etcd leader change rate detected.");
    }
  }

  if (metricRates.dbSizeGrowthBytesPerHour !== undefined) {
    if (metricRates.dbSizeGrowthBytesPerHour >= DB_GROWTH_CRITICAL_BYTES_PER_HOUR) {
      isCritical = true;
      warnings.push("Rapid etcd database growth detected.");
    } else if (metricRates.dbSizeGrowthBytesPerHour >= DB_GROWTH_WARN_BYTES_PER_HOUR) {
      warnings.push("etcd database growth is above warning threshold.");
    }
  }

  if (isCritical) return { status: "critical", warnings };
  if (warnings.length) return { status: "warning", warnings };
  if (health.length || statuses.length) return { status: "ok", warnings };
  return { status: "unknown", warnings };
}

function computeMetricRates(clusterId: string, samples: EtcdMetricSample[]): EtcdMetricRate {
  const totals = samples.reduce<{ leaderChanges?: number; dbSizeBytes?: number }>((acc, sample) => {
    if (sample.leaderChangesTotal !== undefined) {
      acc.leaderChanges = (acc.leaderChanges ?? 0) + (sample.leaderChangesTotal ?? 0);
    }
    if (sample.dbSizeBytes !== undefined) {
      acc.dbSizeBytes = Math.max(acc.dbSizeBytes ?? 0, sample.dbSizeBytes ?? 0);
    }
    return acc;
  }, {});

  const now = Date.now();
  const previous = metricsHistory.get(clusterId);
  metricsHistory.set(clusterId, { capturedAt: now, totals });

  if (!previous?.capturedAt) {
    return {};
  }

  const hours = (now - previous.capturedAt) / (1000 * 60 * 60);
  if (hours <= 0) return {};

  const rates: EtcdMetricRate = {};
  if (totals.leaderChanges !== undefined && previous.totals.leaderChanges !== undefined) {
    const delta = totals.leaderChanges - previous.totals.leaderChanges;
    if (delta >= 0) {
      rates.leaderChangesPerHour = delta / hours;
    }
  }
  if (totals.dbSizeBytes !== undefined && previous.totals.dbSizeBytes !== undefined) {
    const delta = totals.dbSizeBytes - previous.totals.dbSizeBytes;
    if (delta >= 0) {
      rates.dbSizeGrowthBytesPerHour = delta / hours;
    }
  }

  return rates;
}

async function fetchEtcdMetrics(
  clusterId: string,
  pods: EtcdPodInfo[],
): Promise<EtcdMetricSample[]> {
  const cached = cachedMetrics.get(clusterId);
  if (cached && Date.now() - cached.fetchedAt < METRICS_CACHE_MS) {
    return cached.data;
  }

  const samples: EtcdMetricSample[] = [];
  for (const pod of pods) {
    if (!pod.name) continue;
    const raw = await kubectlRawFront(
      `get --raw /api/v1/namespaces/${ETCD_NAMESPACE}/pods/${pod.name}:${ETCD_PORT}/proxy/metrics`,
      { clusterId },
    );
    if (raw.errors) {
      await logEtcdProbeErrorIfUnexpected(
        `etcd metrics fetch failed for ${pod.name}: ${raw.errors}`,
      );
      continue;
    }
    const sample = parseEtcdMetrics(raw.output, pod.name);
    if (sample) samples.push(sample);
  }

  cachedMetrics.set(clusterId, { data: samples, fetchedAt: Date.now() });
  return samples;
}

export async function checkEtcdHealth(
  clusterId: string,
  options?: { force?: boolean },
): Promise<EtcdHealthReport> {
  const cached = cachedHealth.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < HEALTH_CACHE_MS) {
    return cached.data;
  }

  let errorMessage: string | undefined;
  const pods = await loadEtcdPods(clusterId);

  if (!pods.length) {
    const fallback = {
      status: "unknown",
      summary: {
        status: "unknown",
        warnings: ["etcd pods are not visible in the cluster; the control plane may be managed."],
        updatedAt: Date.now(),
      },
      health: [],
      endpointStatus: [],
      metrics: [],
      metricRates: {},
      errors: "No etcd pods found.",
      updatedAt: Date.now(),
    } satisfies EtcdHealthReport;
    cachedHealth.set(clusterId, { data: fallback, fetchedAt: Date.now() });
    return fallback;
  }

  const endpoints = pods
    .map((pod) => pod.ip)
    .filter((value): value is string => Boolean(value))
    .map((ip) => `https://${ip}:${ETCD_PORT}`)
    .join(",");

  if (!endpoints) {
    const fallback = {
      status: "unknown",
      summary: {
        status: "unknown",
        warnings: ["No etcd endpoints discovered."],
        updatedAt: Date.now(),
      },
      health: [],
      endpointStatus: [],
      metrics: [],
      metricRates: {},
      errors: "No etcd endpoints discovered.",
      updatedAt: Date.now(),
    } satisfies EtcdHealthReport;
    cachedHealth.set(clusterId, { data: fallback, fetchedAt: Date.now() });
    return fallback;
  }

  const targetPod = pods[0];
  const execBase = `exec -n ${ETCD_NAMESPACE} ${targetPod.name} -- etcdctl`;
  let health: EtcdEndpointHealth[] = [];
  let endpointStatus: EtcdEndpointStatus[] = [];

  try {
    const healthResult = await kubectlRawFront(
      buildEtcdctlCommand(execBase, endpoints, "endpoint health --cluster", targetPod.tlsConfig),
      {
        clusterId,
        source: "check-etcd-health:endpoint-health",
        allowCommandUnavailable: true,
      },
    );
    if (healthResult.errors || healthResult.code !== 0) {
      errorMessage = healthResult.errors || "Failed to run etcd health check.";
      await logEtcdProbeErrorIfUnexpected(`etcd health check failed: ${errorMessage}`);
    } else {
      health = parseEtcdHealthOutput(healthResult.output);
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to run etcd health check.";
    await logEtcdProbeErrorIfUnexpected(`etcd health check failed: ${errorMessage}`);
  }

  try {
    const statusResult = await kubectlRawFront(
      buildEtcdctlCommand(
        execBase,
        endpoints,
        "endpoint status --write-out=json",
        targetPod.tlsConfig,
      ),
      {
        clusterId,
        source: "check-etcd-health:endpoint-status",
        allowCommandUnavailable: true,
      },
    );
    if (statusResult.errors || statusResult.code !== 0) {
      const statusError = statusResult.errors || "Failed to run etcd status check.";
      errorMessage = errorMessage ?? statusError;
      await logEtcdProbeErrorIfUnexpected(`etcd status check failed: ${statusError}`);
    } else {
      endpointStatus = parseEtcdStatusOutput(statusResult.output);
    }
  } catch (error) {
    const statusError = error instanceof Error ? error.message : "Failed to run etcd status check.";
    errorMessage = errorMessage ?? statusError;
    await logEtcdProbeErrorIfUnexpected(`etcd status check failed: ${statusError}`);
  }

  const metrics = await fetchEtcdMetrics(clusterId, pods);
  const metricRates = computeMetricRates(clusterId, metrics);
  const summary = buildStatusSummary(health, endpointStatus, metrics, metricRates, errorMessage);

  const report: EtcdHealthReport = {
    status: summary.status,
    summary: { ...summary, updatedAt: Date.now() },
    health,
    endpointStatus,
    metrics,
    metricRates,
    errors: errorMessage,
    updatedAt: Date.now(),
  };

  cachedHealth.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
