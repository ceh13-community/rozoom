import type { AppClusterConfig } from "$entities/config";
import type { ClusterHealthChecks, HealthChecks } from "$features/check-health";

const SYNTHETIC_FLEET_SIZES = new Set([50, 100]);

type SyntheticClusterVariant = "healthy" | "warning" | "critical" | "offline";
export type SyntheticStressPreset = "balanced" | "slow_fleet" | "queue_pressure";

export const SYNTHETIC_STRESS_PRESETS: ReadonlyArray<{
  id: SyntheticStressPreset;
  label: string;
  description: string;
}> = [
  {
    id: "balanced",
    label: "Balanced",
    description: "Healthy mixed fleet with moderate latency.",
  },
  {
    id: "slow_fleet",
    label: "Slow Fleet",
    description: "Inflates cluster refresh time to model slower large fleets.",
  },
  {
    id: "queue_pressure",
    label: "Queue Pressure",
    description: "Pushes more cards into long-running work to stress the queue.",
  },
] as const;

function buildMetricsEndpoints(variant: SyntheticClusterVariant) {
  const metricsServerStatus =
    variant === "critical"
      ? "❌ Unreachable"
      : variant === "warning"
        ? "🟠 Degraded"
        : "✅ Available";
  return {
    kubelet: { title: "Kubelet", status: "✅ Available", lastSync: "just now" },
    metrics_server: {
      title: "Metrics Server",
      status: metricsServerStatus,
      lastSync: "just now",
      error:
        variant === "critical"
          ? "metrics-server unavailable"
          : variant === "warning"
            ? "metrics-server degraded"
            : undefined,
    },
    kube_state_metrics: {
      title: "kube-state-metrics",
      status: "✅ Available",
      lastSync: "just now",
    },
    node_exporter: { title: "node-exporter", status: "✅ Available", lastSync: "just now" },
  };
}

function buildDiagnosticsSummary(status: "ok" | "warning" | "critical") {
  return {
    status,
    summary: {
      status,
      ok: status === "ok" ? 1 : 0,
      warning: status === "warning" ? 1 : 0,
      critical: status === "critical" ? 1 : 0,
      total: 1,
      updatedAt: Date.now(),
    },
    items: [],
  };
}

function buildSyntheticCheck(index: number, clusterId: string, variant: SyntheticClusterVariant) {
  const namespacesCount = 8 + (index % 12);
  const pods = 20 + index * 3;
  const deployments = 4 + (index % 18);
  const replicaSets = deployments + 1 + (index % 7);
  const daemonSets = 1 + (index % 6);
  const statefulSets = index % 5;
  const jobs = index % 8;
  const cronJobs = index % 4;
  const nodesTotal = 2 + (index % 6);
  const nodesReady = variant === "critical" ? Math.max(1, nodesTotal - 2) : nodesTotal;
  const status = variant === "critical" ? "critical" : variant === "warning" ? "warning" : "ok";
  const timestamp = Date.now() - index * 1_000;

  return {
    timestamp,
    updatedAt: timestamp,
    offline: variant === "offline",
    pods,
    deployments,
    replicaSets,
    daemonSets,
    statefulSets,
    jobs,
    cronJobs,
    namespaces: Array.from(
      { length: namespacesCount },
      (_, nsIndex) => `ns-${index + 1}-${nsIndex + 1}`,
    ),
    nodes: {
      checks: [],
      summary: {
        status: variant === "critical" ? "Critical" : variant === "warning" ? "Warning" : "Ok",
        count: {
          ready: nodesReady,
          total: nodesTotal,
          pressures: {
            diskPressure: variant === "critical" ? 1 : 0,
            memoryPressure: variant === "warning" ? 1 : 0,
            pidPressure: 0,
            networkUnavailable: 0,
          },
        },
      },
    },
    metricsChecks: {
      endpoints: buildMetricsEndpoints(variant),
    },
    apiServerHealth: {
      status,
      live: { ok: variant !== "critical", output: variant === "critical" ? "degraded" : "ok" },
      ready: { ok: variant === "healthy", output: variant === "healthy" ? "ok" : "partial" },
      updatedAt: timestamp,
    },
    apiServerLatency: {
      status,
      overall: {
        p50: variant === "critical" ? 0.7 : variant === "warning" ? 0.25 : 0.09,
        p95: variant === "critical" ? 1.5 : variant === "warning" ? 0.55 : 0.12,
        p99: variant === "critical" ? 2.2 : variant === "warning" ? 0.8 : 0.18,
      },
      summary: {
        message:
          variant === "critical"
            ? "API latency is degraded"
            : variant === "warning"
              ? "API latency is elevated"
              : "API latency is healthy",
      },
    },
    certificatesHealth: {
      status,
      certificates: [],
      kubeletRotation: [],
      summary: {
        status,
        warnings: variant === "healthy" ? [] : ["Synthetic certificate warning"],
        message:
          variant === "critical"
            ? "Certificates require attention"
            : variant === "warning"
              ? "Certificates expiring soon"
              : "Certificates healthy",
      },
      updatedAt: timestamp,
    },
    podIssues: {
      status,
      summary: {
        status,
        warnings: variant === "healthy" ? [] : ["Synthetic workload warning"],
        updatedAt: timestamp,
      },
      items: [],
      totalPods: pods,
      crashLoopCount: variant === "critical" ? 2 : 0,
      pendingCount: variant === "warning" ? 1 : 0,
      updatedAt: timestamp,
    },
    podRestarts:
      variant === "healthy"
        ? []
        : [
            {
              namespace: "default",
              podName: `synthetic-${clusterId}-pod`,
              workloadName: `synthetic-${clusterId}`,
              workloadKind: "Deployment",
              containers: [{ name: "app", restartCount: variant === "critical" ? 6 : 2 }],
            },
          ],
    cronJobsHealth: {
      items: [],
      summary: {
        total: cronJobs,
        ok: Math.max(0, cronJobs - (variant === "warning" ? 1 : 0)),
        warning: variant === "warning" ? 1 : 0,
        critical: variant === "critical" ? 1 : 0,
        unknown: 0,
      },
      updatedAt: timestamp,
    },
    admissionWebhooks: buildDiagnosticsSummary(status),
    warningEvents: buildDiagnosticsSummary(status),
    blackboxProbes: buildDiagnosticsSummary(status),
    apfHealth: buildDiagnosticsSummary(status),
    etcdHealth: buildDiagnosticsSummary(status),
    resourcesHygiene: buildDiagnosticsSummary(status),
    hpaStatus: buildDiagnosticsSummary("ok"),
    probesHealth: buildDiagnosticsSummary(status),
    podQos: buildDiagnosticsSummary("ok"),
    vpaStatus: buildDiagnosticsSummary("ok"),
    topologyHa: buildDiagnosticsSummary(status),
    pdbStatus: buildDiagnosticsSummary(status),
    priorityStatus: buildDiagnosticsSummary("ok"),
    podSecurity: buildDiagnosticsSummary(status),
    networkIsolation: buildDiagnosticsSummary(status),
    secretsHygiene: buildDiagnosticsSummary(status),
    securityHardening: buildDiagnosticsSummary(status),
  } as unknown as ClusterHealthChecks;
}

function clusterVariantForIndex(index: number): SyntheticClusterVariant {
  if (index % 17 === 0) return "critical";
  if (index % 7 === 0) return "warning";
  if (index % 29 === 0) return "offline";
  return "healthy";
}

export function syntheticFleetHarnessEnabled() {
  return true;
}

export function resolveSyntheticFleetSize(raw: string | null | undefined) {
  const parsed = Number.parseInt(raw ?? "", 10);
  return SYNTHETIC_FLEET_SIZES.has(parsed) ? parsed : null;
}

export function buildSyntheticFleet(size: number): {
  clusters: AppClusterConfig[];
  healthChecks: HealthChecks;
} {
  if (!SYNTHETIC_FLEET_SIZES.has(size)) {
    throw new Error(`Unsupported synthetic fleet size: ${size}`);
  }

  const now = Date.now();
  const clusters: AppClusterConfig[] = [];
  const healthChecks: HealthChecks = {};

  for (let index = 0; index < size; index += 1) {
    const clusterId = `synthetic-${size}-${String(index + 1).padStart(3, "0")}`;
    const variant = clusterVariantForIndex(index + 1);
    clusters.push({
      uuid: clusterId,
      name: `Synthetic Fleet ${String(index + 1).padStart(3, "0")}`,
      addedAt: new Date(now - index * 60_000),
      provider: index % 2 === 0 ? "eks" : "k3s",
      env: index % 3 === 0 ? "prod" : "dev",
      source: "synthetic-fleet-harness",
      tags: [variant, size === 100 ? "hundred" : "fifty"],
      offline: variant === "offline",
      needsInitialRefreshHint: false,
    });
    healthChecks[clusterId] = [buildSyntheticCheck(index + 1, clusterId, variant)];
  }

  return { clusters, healthChecks };
}

export function resolveSyntheticRefreshProfile(
  clusterId: string,
  preset: SyntheticStressPreset = "balanced",
) {
  const parts = clusterId.split("-");
  const ordinal = Number.parseInt(parts[parts.length - 1] ?? "1", 10);
  const seed = Number.isFinite(ordinal) && ordinal > 0 ? ordinal : 1;
  const bucket = seed % 5;
  const status = clusterVariantForIndex(seed);
  const baseDurationMs = [220, 480, 950, 1_650, 2_800][bucket] ?? 950;
  const durationMultiplier = preset === "slow_fleet" ? 1.8 : preset === "queue_pressure" ? 2.4 : 1;
  const queuePenaltyMs =
    preset === "queue_pressure" && seed % 3 === 0
      ? 900
      : preset === "slow_fleet" && seed % 4 === 0
        ? 250
        : 0;
  const durationMs = Math.round(baseDurationMs * durationMultiplier) + queuePenaltyMs;
  return {
    seed,
    status,
    durationMs,
    preset,
  };
}
