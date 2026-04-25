/**
 * Derive a one-line fleet health summary for the Cluster Manager page
 * top overview card. Pure, fully covered by unit tests.
 *
 * Inputs:
 *   - list of clusters
 *   - optional map of runtime state (from clusterStates)
 *   - optional map of last health check (from clusterHealthChecks)
 *   - optional inferred env per cluster
 *
 * Output: counts broken down by status so the UI can render clickable
 * chips that filter the managed table.
 */
import type { AppClusterConfig } from "$entities/config/";

export type FleetStatusBucket =
  | "online"
  | "offline"
  | "auth-error"
  | "critical"
  | "warning"
  | "unknown";

export type FleetSummary = {
  total: number;
  online: number;
  offline: number;
  authErrors: number;
  critical: number;
  warning: number;
  unknown: number;
  /** Keyed by env label. Unknown env is grouped under "other". */
  envBreakdown: Record<string, number>;
  /** Keyed by provider label. */
  providerBreakdown: Record<string, number>;
};

type ClusterStateLike = {
  loading?: boolean;
  error?: string | null;
};

type ClusterHealthLike =
  | {
      errors?: unknown;
      status?: string;
      apiServerHealth?: { status?: string };
      etcdHealth?: { status?: string };
      podIssues?: { status?: string };
      warningEvents?: { status?: string };
    }
  | null
  | undefined;

export type FleetSummaryInputs = {
  clusters: AppClusterConfig[];
  states?: Record<string, ClusterStateLike>;
  health?: Record<string, ClusterHealthLike>;
  envFor?: (cluster: AppClusterConfig) => string | undefined;
  providerFor?: (cluster: AppClusterConfig) => string | undefined;
};

const AUTH_ERROR_HINTS = [
  "unauthorized",
  "forbidden",
  "401",
  "403",
  "token has expired",
  "invalid credentials",
  "x509",
];

const CONNECTION_ERROR_HINTS = [
  "connection refused",
  "timeout",
  "no route to host",
  "dial tcp",
  "network unreachable",
  "eof",
  "dns",
  // Go's context.DeadlineExceeded surfaces as the bare phrase
  // "context deadline exceeded" when kubectl's --request-timeout fires
  // before "Client.Timeout..." text is added. Seen in production logs.
  "deadline exceeded",
  "unable to connect to the server",
  "server misbehaving",
  "i/o timeout",
];

function isAuthError(err: string | null | undefined): boolean {
  if (!err) return false;
  const lc = err.toLowerCase();
  return AUTH_ERROR_HINTS.some((h) => lc.includes(h));
}

function isConnectionError(err: string | null | undefined): boolean {
  if (!err) return false;
  const lc = err.toLowerCase();
  return CONNECTION_ERROR_HINTS.some((h) => lc.includes(h));
}

/**
 * Bucket a single cluster based on runtime signals.
 * Priority: auth-error > offline > critical > warning > online > unknown.
 */
export function bucketCluster(
  cluster: AppClusterConfig,
  state: ClusterStateLike | undefined,
  health: ClusterHealthLike,
): FleetStatusBucket {
  if (state?.error) {
    if (isAuthError(state.error)) return "auth-error";
    if (isConnectionError(state.error)) return "offline";
  }
  if (cluster.offline === true) return "offline";

  if (health && !("errors" in health && health.errors)) {
    const h = health;
    const statuses = [
      h.apiServerHealth?.status,
      h.etcdHealth?.status,
      h.podIssues?.status,
      h.warningEvents?.status,
    ];
    if (statuses.some((s) => s === "critical")) return "critical";
    if (statuses.some((s) => s === "warning")) return "warning";
    return "online";
  }

  if (health && "errors" in health && health.errors) {
    return "unknown";
  }

  if (cluster.status === "error") return "offline";
  if (cluster.status === "ok") return "online";

  return "unknown";
}

export function buildFleetSummary(inputs: FleetSummaryInputs): FleetSummary {
  const { clusters, states = {}, health = {}, envFor, providerFor } = inputs;

  const summary: FleetSummary = {
    total: clusters.length,
    online: 0,
    offline: 0,
    authErrors: 0,
    critical: 0,
    warning: 0,
    unknown: 0,
    envBreakdown: {},
    providerBreakdown: {},
  };

  for (const cluster of clusters) {
    const bucket = bucketCluster(cluster, states[cluster.uuid], health[cluster.uuid]);
    switch (bucket) {
      case "online":
        summary.online += 1;
        break;
      case "offline":
        summary.offline += 1;
        break;
      case "auth-error":
        summary.authErrors += 1;
        break;
      case "critical":
        summary.critical += 1;
        summary.online += 1;
        break;
      case "warning":
        summary.warning += 1;
        summary.online += 1;
        break;
      case "unknown":
      default:
        summary.unknown += 1;
        break;
    }

    const env = envFor?.(cluster)?.trim().toLowerCase() || "other";
    summary.envBreakdown[env] = (summary.envBreakdown[env] ?? 0) + 1;

    const provider = providerFor?.(cluster)?.trim() || cluster.provider || "unknown";
    summary.providerBreakdown[provider] = (summary.providerBreakdown[provider] ?? 0) + 1;
  }

  return summary;
}

/**
 * Human-friendly one-line label for the top of the fleet card.
 * Example: "7/8 online · 1 auth issue · 3 prod / 2 staging / 3 dev".
 */
export function fleetSummaryHeadline(summary: FleetSummary): string {
  if (summary.total === 0) return "No clusters connected yet";
  const parts: string[] = [];
  parts.push(`${summary.online}/${summary.total} online`);
  if (summary.authErrors > 0) {
    parts.push(`${summary.authErrors} auth ${summary.authErrors === 1 ? "issue" : "issues"}`);
  }
  if (summary.offline > 0) {
    parts.push(`${summary.offline} offline`);
  }
  if (summary.critical > 0) {
    parts.push(`${summary.critical} critical`);
  }
  const envs = Object.entries(summary.envBreakdown)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([env, n]) => `${n} ${env}`);
  if (envs.length > 0) parts.push(envs.join(" / "));
  return parts.join(" · ");
}
