/**
 * Alert Correlation (#28)
 *
 * Groups related alerts by namespace, time window, and commonality.
 * Helps identify incident scope vs isolated alerts.
 */

export type AlertItem = {
  name: string;
  namespace: string;
  severity: string;
  status: string;
  startsAt: string;
  message: string;
  labels: Record<string, string>;
};

export type AlertCorrelationGroup = {
  id: string;
  namespace: string;
  alerts: AlertItem[];
  timeWindowMs: number;
  commonLabels: Record<string, string>;
  severity: "critical" | "warning" | "info";
  summary: string;
};

export type AlertCorrelationResult = {
  groups: AlertCorrelationGroup[];
  totalAlerts: number;
  correlatedAlerts: number;
  isolatedAlerts: number;
  incidentScore: number;
};

const CORRELATION_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function findCommonLabels(alerts: AlertItem[]): Record<string, string> {
  if (alerts.length === 0) return {};
  const first = alerts[0].labels;
  const common: Record<string, string> = {};
  for (const [key, value] of Object.entries(first)) {
    if (key === "alertname" || key === "severity") continue;
    if (alerts.every((a) => a.labels[key] === value)) {
      common[key] = value;
    }
  }
  return common;
}

function groupSeverity(alerts: AlertItem[]): AlertCorrelationGroup["severity"] {
  if (alerts.some((a) => a.severity === "critical")) return "critical";
  if (alerts.some((a) => a.severity === "warning")) return "warning";
  return "info";
}

export function correlateAlerts(
  alerts: AlertItem[],
  windowMs = CORRELATION_WINDOW_MS,
): AlertCorrelationResult {
  // Group by namespace first
  const byNamespace = new Map<string, AlertItem[]>();
  for (const alert of alerts) {
    const ns = alert.namespace || "cluster";
    const list = byNamespace.get(ns) ?? [];
    list.push(alert);
    byNamespace.set(ns, list);
  }

  const groups: AlertCorrelationGroup[] = [];
  const correlatedIds = new Set<string>();
  let groupCounter = 0;

  for (const [namespace, nsAlerts] of byNamespace) {
    // Sort by time
    const sorted = [...nsAlerts].sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    );

    // Sliding window clustering
    let windowStart = 0;
    while (windowStart < sorted.length) {
      const windowAlerts: AlertItem[] = [sorted[windowStart]];
      const startTime = new Date(sorted[windowStart].startsAt).getTime();

      let j = windowStart + 1;
      while (j < sorted.length) {
        const jTime = new Date(sorted[j].startsAt).getTime();
        if (jTime - startTime <= windowMs) {
          windowAlerts.push(sorted[j]);
          j++;
        } else {
          break;
        }
      }

      if (windowAlerts.length >= 2) {
        groupCounter++;
        const commonLabels = findCommonLabels(windowAlerts);
        groups.push({
          id: `group-${groupCounter}`,
          namespace,
          alerts: windowAlerts,
          timeWindowMs: windowMs,
          commonLabels,
          severity: groupSeverity(windowAlerts),
          summary: `${windowAlerts.length} alerts in ${namespace} within ${Math.round(windowMs / 60000)}min`,
        });
        for (const a of windowAlerts) correlatedIds.add(`${a.namespace}/${a.name}/${a.startsAt}`);
      }

      windowStart = j;
    }
  }

  // Sort groups by severity then size
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  groups.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] || b.alerts.length - a.alerts.length,
  );

  const correlated = correlatedIds.size;
  const isolated = alerts.length - correlated;
  const incidentScore = alerts.length > 0 ? Math.round((correlated / alerts.length) * 100) : 0;

  return {
    groups,
    totalAlerts: alerts.length,
    correlatedAlerts: correlated,
    isolatedAlerts: isolated,
    incidentScore,
  };
}
