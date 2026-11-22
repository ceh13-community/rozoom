// One reading of a Kubernetes Event for every details panel, so the Events block counts
// repeats the same way everywhere.

export type KubeEventJson = {
  type?: string;
  reason?: string;
  message?: string;
  lastTimestamp?: string;
  eventTime?: string;
  firstTimestamp?: string;
  reportingController?: string;
  source?: { component?: string; host?: string };
  count?: string | number;
  /** events.k8s.io events count their repeats here instead of in `count`. */
  series?: { count?: number };
};

export type KubeEvent = {
  type: string;
  reason: string;
  message: string;
  lastTimestamp: string;
  source?: string;
  /** How many times it happened; undefined when Kubernetes did not say. */
  count?: number;
};

function toCount(value: string | number | undefined): number | undefined {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function toKubeEvent(event: KubeEventJson): KubeEvent {
  return {
    type: event.type ?? "-",
    reason: event.reason ?? "-",
    message: event.message ?? "-",
    lastTimestamp: event.lastTimestamp || event.eventTime || event.firstTimestamp || "-",
    source: event.reportingController || event.source?.component || event.source?.host || undefined,
    count: toCount(event.count) ?? toCount(event.series?.count),
  };
}

/** Events from `kubectl get events -o json` (or `kubectl events -o json`). */
export function parseKubeEvents(output: string): KubeEvent[] {
  const parsed = JSON.parse(output || "{}") as { items?: KubeEventJson[] };
  return (parsed.items ?? []).map(toKubeEvent);
}
