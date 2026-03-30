/**
 * Incident Timeline (#30)
 *
 * Unified timeline: pod restarts + alerts + events + deploys
 * on a single chronological view.
 */

export type IncidentTimelineItemKind =
  | "pod-restart"
  | "alert-firing"
  | "alert-resolved"
  | "event-warning"
  | "deployment-change"
  | "node-pressure"
  | "scaling-event";

export type IncidentTimelineItem = {
  kind: IncidentTimelineItemKind;
  timestamp: number;
  title: string;
  detail: string;
  namespace: string;
  resource: string;
  severity: "critical" | "warning" | "info";
};

export type IncidentTimelineResult = {
  items: IncidentTimelineItem[];
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  timeRangeMs: number;
  peakMinute: number | null;
};

export type TimelineInput = {
  podRestarts?: Array<{
    podName: string;
    namespace: string;
    containerName: string;
    restartCount: number;
    reason: string;
    timestamp: string;
  }>;
  alerts?: Array<{
    name: string;
    namespace: string;
    severity: string;
    status: string;
    startsAt: string;
    endsAt?: string;
    message: string;
  }>;
  warningEvents?: Array<{
    name: string;
    namespace: string;
    reason: string;
    message: string;
    lastTimestamp: string;
    count: number;
  }>;
  deploymentChanges?: Array<{
    name: string;
    namespace: string;
    generation: number;
    timestamp: string;
    replicas: number;
  }>;
  nodePressures?: Array<{
    nodeName: string;
    pressureType: string;
    status: string;
    timestamp: string;
  }>;
};

function parseTs(value: string): number {
  if (!value) return 0;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.getTime() : 0;
}

export function buildIncidentTimeline(input: TimelineInput): IncidentTimelineResult {
  const items: IncidentTimelineItem[] = [];

  // Pod restarts
  for (const restart of input.podRestarts ?? []) {
    const ts = parseTs(restart.timestamp);
    if (ts === 0) continue;
    items.push({
      kind: "pod-restart",
      timestamp: ts,
      title: `Pod restart: ${restart.podName}`,
      detail: `Container ${restart.containerName}: ${restart.reason} (restart #${restart.restartCount})`,
      namespace: restart.namespace,
      resource: restart.podName,
      severity: restart.restartCount > 3 ? "critical" : "warning",
    });
  }

  // Alerts
  for (const alert of input.alerts ?? []) {
    const ts = parseTs(alert.startsAt);
    if (ts === 0) continue;
    items.push({
      kind: alert.status === "resolved" ? "alert-resolved" : "alert-firing",
      timestamp: ts,
      title: `Alert: ${alert.name}`,
      detail: alert.message,
      namespace: alert.namespace,
      resource: alert.name,
      severity:
        alert.severity === "critical"
          ? "critical"
          : alert.severity === "warning"
            ? "warning"
            : "info",
    });
  }

  // Warning events
  for (const event of input.warningEvents ?? []) {
    const ts = parseTs(event.lastTimestamp);
    if (ts === 0) continue;
    items.push({
      kind: "event-warning",
      timestamp: ts,
      title: `Event: ${event.reason}`,
      detail: `${event.message} (x${event.count})`,
      namespace: event.namespace,
      resource: event.name,
      severity: event.count > 5 ? "critical" : "warning",
    });
  }

  // Deployment changes
  for (const deploy of input.deploymentChanges ?? []) {
    const ts = parseTs(deploy.timestamp);
    if (ts === 0) continue;
    items.push({
      kind: "deployment-change",
      timestamp: ts,
      title: `Deploy: ${deploy.name}`,
      detail: `Generation ${deploy.generation}, replicas: ${deploy.replicas}`,
      namespace: deploy.namespace,
      resource: deploy.name,
      severity: "info",
    });
  }

  // Node pressures
  for (const pressure of input.nodePressures ?? []) {
    const ts = parseTs(pressure.timestamp);
    if (ts === 0) continue;
    items.push({
      kind: "node-pressure",
      timestamp: ts,
      title: `Node pressure: ${pressure.nodeName}`,
      detail: `${pressure.pressureType}: ${pressure.status}`,
      namespace: "cluster",
      resource: pressure.nodeName,
      severity: "critical",
    });
  }

  // Sort chronologically
  items.sort((a, b) => a.timestamp - b.timestamp);

  // Find peak minute (most events in a 60s window)
  let peakMinute: number | null = null;
  let peakCount = 0;
  for (let i = 0; i < items.length; i++) {
    const windowEnd = items[i].timestamp + 60000;
    let count = 0;
    for (let j = i; j < items.length && items[j].timestamp <= windowEnd; j++) {
      count++;
    }
    if (count > peakCount) {
      peakCount = count;
      peakMinute = items[i].timestamp;
    }
  }

  const timeRangeMs =
    items.length >= 2 ? items[items.length - 1].timestamp - items[0].timestamp : 0;

  return {
    items,
    criticalCount: items.filter((i) => i.severity === "critical").length,
    warningCount: items.filter((i) => i.severity === "warning").length,
    infoCount: items.filter((i) => i.severity === "info").length,
    timeRangeMs,
    peakMinute: peakCount > 1 ? peakMinute : null,
  };
}
