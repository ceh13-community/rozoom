import { get, writable } from "svelte/store";
import { checkWarningEvents } from "$features/check-health";
import { updateClusterCheckPartially } from "$features/check-health/model/cache-store";
import { getPrometheusStackRelease } from "$shared/api/helm";
import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import {
  clusterRuntimeBudget,
  clusterRuntimeContext,
  isClusterRuntimeHeavyDiagnosticsActive,
} from "$shared/lib/cluster-runtime-manager";
import {
  activeDashboardRoute,
  isDashboardFeatureRouteActive,
} from "$shared/lib/dashboard-route-activity";
import type {
  AlertHubConfig,
  AlertHubState,
  AlertItem,
  AlertSilenceRequest,
  AlertSource,
  AlertState,
} from "./types";

const DEFAULT_CONFIG: AlertHubConfig = {
  cacheTtlMs: 30 * 1000,
  scheduleMs: 15 * 1000,
};

export const alertHubConfig = writable<AlertHubConfig>(DEFAULT_CONFIG);
export const alertHubState = writable<Record<string, AlertHubState | undefined>>({});

type PollController = {
  refCount: number;
  timer: ReturnType<typeof setInterval> | null;
};

const pollControllers = new Map<string, PollController>();

type AlertmanagerApiAlert = {
  fingerprint?: string;
  status?: {
    state?: string;
    silencedBy?: string[];
    inhibitedBy?: string[];
  };
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  startsAt?: string;
  updatedAt?: string;
  receivers?: Array<{ name?: string }>;
};

function severityFromAlertmanagerLabels(labels: Record<string, string>): AlertItem["severity"] {
  const level = (labels.severity || labels.level || "").toLowerCase();
  if (level.includes("critical") || level.includes("page")) return "page";
  if (level.includes("warn")) return "warn";
  if (level.includes("info")) return "info";
  return "unknown";
}

function stateFromAlertmanagerStatus(status: AlertmanagerApiAlert["status"]): AlertItem["state"] {
  if ((status?.silencedBy ?? []).length > 0) return "silenced";
  if ((status?.inhibitedBy ?? []).length > 0) return "inhibited";
  return "firing";
}

function parseAlertmanagerAlerts(raw: string): AlertmanagerApiAlert[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AlertmanagerApiAlert[]) : [];
  } catch {
    return [];
  }
}

function mapAlertmanagerAlerts(clusterId: string, items: AlertmanagerApiAlert[]): AlertItem[] {
  return items.map((item, index) => {
    const labels = item.labels ?? {};
    const annotations = item.annotations ?? {};
    const alertname = labels.alertname || annotations.summary || `alert-${index + 1}`;
    const since = item.startsAt || item.updatedAt || new Date().toISOString();
    const receiver = item.receivers?.[0]?.name;
    return {
      id: item.fingerprint || `${clusterId}-${alertname}-${since}-${index}`,
      state: stateFromAlertmanagerStatus(item.status),
      severity: severityFromAlertmanagerLabels(labels),
      alertname,
      since,
      namespace: labels.namespace,
      pod: labels.pod,
      node: labels.node,
      receiver,
      summary: annotations.summary,
      description: annotations.description,
      source: "alertmanager",
      labels,
      annotations,
    };
  });
}

async function fetchAlertmanagerAlerts(clusterId: string): Promise<{
  alerts: AlertItem[];
  error?: string;
}> {
  const release = await getPrometheusStackRelease(clusterId);
  if (release.error) {
    return { alerts: [], error: release.error };
  }
  if (!release.installed) {
    return { alerts: [], error: "Prometheus stack is not installed." };
  }

  const namespace = release.release?.namespace || "monitoring";
  const releaseName = release.release?.name || "kube-prometheus-stack";
  const paths = [
    `/api/v1/namespaces/${namespace}/services/http:alertmanager-operated:9093/proxy/api/v2/alerts`,
    `/api/v1/namespaces/${namespace}/services/http:alertmanager-operated/proxy/api/v2/alerts`,
    `/api/v1/namespaces/${namespace}/services/http:alertmanager-${releaseName}-kube-prometheus-alertmanager:9093/proxy/api/v2/alerts`,
    `/api/v1/namespaces/${namespace}/services/http:alertmanager-${releaseName}-kube-prometheus-alertmanager/proxy/api/v2/alerts`,
  ];

  const errors: string[] = [];
  for (const path of paths) {
    const result = await kubectlRawArgsFront(["get", "--raw", path], { clusterId });
    if (result.errors || result.code !== 0) {
      errors.push(result.errors || result.output || `Failed to query ${path}`);
      continue;
    }
    const parsed = parseAlertmanagerAlerts(result.output || "[]");
    return { alerts: mapAlertmanagerAlerts(clusterId, parsed) };
  }

  return {
    alerts: [],
    error: errors[0] || "Failed to fetch alerts from Alertmanager API",
  };
}

function severityFromEventReason(reason: string): AlertItem["severity"] {
  const normalized = reason.toLowerCase();
  if (normalized.includes("notready") || normalized.includes("failed")) return "page";
  if (normalized.includes("backoff") || normalized.includes("oom")) return "warn";
  return "info";
}

function buildSummary(
  source: AlertSource,
  runAt: string,
  alerts: AlertItem[],
): AlertHubState["summary"] {
  if (alerts.length === 0) {
    return {
      status: "ok",
      lastRunAt: runAt,
      source,
      message: "No active alerts",
      alertmanagerLastSuccessAt: null,
      alertmanagerLastError: null,
    };
  }

  const hasActionableAlerts = alerts.some(
    (alert) => alert.state === "firing" || alert.state === "pending",
  );
  const status = hasActionableAlerts ? "degraded" : "ok";
  const pageCount = alerts.filter((alert) => alert.severity === "page").length;
  const warnCount = alerts.filter((alert) => alert.severity === "warn").length;
  return {
    status,
    lastRunAt: runAt,
    source,
    message:
      pageCount > 0 || warnCount > 0
        ? `${alerts.length} active alert${alerts.length === 1 ? "" : "s"} · ${pageCount} page / ${warnCount} warn`
        : `${alerts.length} alert${alerts.length === 1 ? "" : "s"} loaded`,
    alertmanagerLastSuccessAt: null,
    alertmanagerLastError: null,
  };
}

function mapWarningEventsToAlerts(
  clusterId: string,
  report: Awaited<ReturnType<typeof checkWarningEvents>>,
) {
  return report.items.map((item) => ({
    id: `${clusterId}-${item.namespace}-${item.objectKind}-${item.objectName}-${item.timestamp}-${item.reason}`,
    state: "firing" as const,
    severity: severityFromEventReason(item.reason),
    alertname: item.reason,
    since: new Date(item.timestamp).toISOString(),
    namespace: item.namespace,
    pod: item.objectKind.toLowerCase() === "pod" ? item.objectName : undefined,
    node: item.objectKind.toLowerCase() === "node" ? item.objectName : undefined,
    summary: item.reason,
    description: item.message,
    source: "events" as const,
    labels: {
      alertname: item.reason,
      namespace: item.namespace,
      objectKind: item.objectKind,
      objectName: item.objectName,
      count: String(item.count),
    },
    annotations: {
      summary: item.reason,
      description: item.message,
    },
  }));
}

export async function runAlertHubScan(
  clusterId: string,
  options?: { force?: boolean },
): Promise<AlertHubState> {
  const config = get(alertHubConfig);
  const currentState = get(alertHubState)[clusterId];

  if (currentState?.summary.lastRunAt && !options?.force) {
    const cachedUntil = new Date(currentState.summary.lastRunAt).getTime() + config.cacheTtlMs;
    if (Date.now() < cachedUntil) {
      return currentState;
    }
  }

  const runAt = new Date().toISOString();
  try {
    const alertmanager = await fetchAlertmanagerAlerts(clusterId);
    let source: AlertSource = "alertmanager";
    let alerts = alertmanager.alerts;
    let errors: string[] | undefined;
    let summary = buildSummary(source, runAt, alerts);
    let normalizedStatus: AlertHubState["summary"]["status"] = summary.status;
    let summaryMessage = summary.message;
    let alertmanagerLastSuccessAt = currentState?.summary.alertmanagerLastSuccessAt ?? null;
    let alertmanagerLastError = currentState?.summary.alertmanagerLastError ?? null;

    if (alertmanager.error) {
      const warningEvents = await checkWarningEvents(clusterId, { force: options?.force });
      source = "events";
      alerts = mapWarningEventsToAlerts(clusterId, warningEvents);
      summary = buildSummary(source, runAt, alerts);
      normalizedStatus =
        warningEvents.status === "unknown"
          ? "unavailable"
          : warningEvents.status === "ok"
            ? "ok"
            : "degraded";
      summaryMessage = warningEvents.summary.message ?? summary.message;
      errors = [
        `Alertmanager unavailable: ${alertmanager.error}`,
        ...(warningEvents.errors ? [warningEvents.errors] : []),
      ];
      alertmanagerLastError = alertmanager.error;
    } else {
      alertmanagerLastSuccessAt = runAt;
      alertmanagerLastError = null;
    }

    const nextState: AlertHubState = {
      summary: {
        ...summary,
        status: normalizedStatus,
        message: summaryMessage,
        alertmanagerLastSuccessAt,
        alertmanagerLastError,
      },
      alerts,
      errors,
    };

    alertHubState.update((state) => ({
      ...state,
      [clusterId]: nextState,
    }));

    await updateClusterCheckPartially(clusterId, {
      alertsSummary: {
        status: nextState.summary.status,
        activeCount: nextState.alerts.filter(
          (alert) => alert.state === "firing" || alert.state === "pending",
        ).length,
        source: nextState.summary.source,
        lastRunAt: nextState.summary.lastRunAt,
        message: nextState.summary.message,
      },
    });

    return nextState;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Failed to refresh alerts feed";
    const nextState: AlertHubState = {
      summary: {
        status: "unavailable",
        lastRunAt: runAt,
        source: "none",
        message: reason,
        alertmanagerLastSuccessAt: currentState?.summary.alertmanagerLastSuccessAt ?? null,
        alertmanagerLastError: reason,
      },
      alerts: [],
      errors: [reason],
    };

    alertHubState.update((state) => ({
      ...state,
      [clusterId]: nextState,
    }));

    await updateClusterCheckPartially(clusterId, {
      alertsSummary: {
        status: nextState.summary.status,
        activeCount: 0,
        source: nextState.summary.source,
        lastRunAt: nextState.summary.lastRunAt,
        message: nextState.summary.message,
      },
    });

    return nextState;
  }
}

export function startAlertHubPolling(clusterId: string) {
  if (!clusterId) return;

  const existing = pollControllers.get(clusterId);
  if (existing) {
    existing.refCount += 1;
    ensureAlertHubPolling(clusterId, existing);
    return;
  }

  const controller: PollController = { refCount: 1, timer: null };
  pollControllers.set(clusterId, controller);
  ensureAlertHubPolling(clusterId, controller);
}

export function stopAlertHubPolling(clusterId: string) {
  const controller = pollControllers.get(clusterId);
  if (!controller) return;
  controller.refCount -= 1;
  if (controller.refCount > 0) return;
  stopAlertHubTimer(controller);
  pollControllers.delete(clusterId);
}

export function stopAllAlertHubPolling() {
  for (const [clusterId, controller] of pollControllers.entries()) {
    stopAlertHubTimer(controller);
    pollControllers.delete(clusterId);
  }
}

function stopAlertHubTimer(controller: PollController) {
  if (!controller.timer) return;
  clearInterval(controller.timer);
  controller.timer = null;
}

function ensureAlertHubPolling(clusterId: string, controller: PollController) {
  if (controller.timer || controller.refCount <= 0) return;
  if (!isClusterRuntimeHeavyDiagnosticsActive(clusterId)) return;
  if (!isDashboardFeatureRouteActive(clusterId, { workloads: ["alertshub"] })) return;

  void runAlertHubScan(clusterId, { force: false });
  const { scheduleMs } = get(alertHubConfig);
  controller.timer = setInterval(() => {
    void runAlertHubScan(clusterId, { force: true });
  }, scheduleMs);
}

function syncAlertHubPolling(clusterId: string, controller: PollController) {
  if (
    isClusterRuntimeHeavyDiagnosticsActive(clusterId) &&
    isDashboardFeatureRouteActive(clusterId, { workloads: ["alertshub"] })
  ) {
    ensureAlertHubPolling(clusterId, controller);
    return;
  }
  stopAlertHubTimer(controller);
}

clusterRuntimeContext.subscribe(() => {
  for (const [clusterId, controller] of pollControllers.entries()) {
    syncAlertHubPolling(clusterId, controller);
  }
});

clusterRuntimeBudget.subscribe(() => {
  for (const [clusterId, controller] of pollControllers.entries()) {
    syncAlertHubPolling(clusterId, controller);
  }
});

activeDashboardRoute.subscribe(() => {
  for (const [clusterId, controller] of pollControllers.entries()) {
    syncAlertHubPolling(clusterId, controller);
  }
});

export function markAlertHubUnavailable(clusterId: string, reason: string) {
  const currentState = get(alertHubState)[clusterId];
  const nextState: AlertHubState = {
    summary: {
      status: "unavailable",
      lastRunAt: null,
      source: "none",
      message: reason,
      alertmanagerLastSuccessAt: currentState?.summary.alertmanagerLastSuccessAt ?? null,
      alertmanagerLastError: reason,
    },
    alerts: [],
    errors: [reason],
  };

  alertHubState.update((state) => ({
    ...state,
    [clusterId]: nextState,
  }));
}

export function createSilence(
  clusterId: string,
  request: AlertSilenceRequest,
): AlertHubState | null {
  const currentState = get(alertHubState)[clusterId];
  if (!currentState) return null;

  const silenceEndsAt = new Date(Date.now() + request.durationHours * 60 * 60 * 1000).toISOString();

  const updatedAlerts = currentState.alerts.map((alert) => {
    if (alert.alertname !== request.alertname) return alert;

    return {
      ...alert,
      state: "silenced" as AlertState,
      silenceId: `silence-${clusterId}-${request.alertname}`,
      silenceEndsAt,
    };
  });

  const summary = buildSummary(
    currentState.summary.source as AlertSource,
    new Date().toISOString(),
    updatedAlerts,
  );
  const nextState: AlertHubState = {
    ...currentState,
    summary: {
      ...summary,
      alertmanagerLastSuccessAt: currentState.summary.alertmanagerLastSuccessAt,
      alertmanagerLastError: currentState.summary.alertmanagerLastError,
    },
    alerts: updatedAlerts,
  };

  alertHubState.update((state) => ({
    ...state,
    [clusterId]: nextState,
  }));

  return nextState;
}
