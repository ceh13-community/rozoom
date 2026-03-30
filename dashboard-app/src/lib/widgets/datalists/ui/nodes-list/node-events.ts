import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";

export type NodeEvent = {
  type: string;
  reason: string;
  message: string;
  lastTimestamp: string;
  source?: string;
  count?: string | number;
};

export function buildNodeEventsArgs(nodeName: string) {
  return ["events", "--for", `node/${nodeName}`, "-o", "json"];
}

export function parseNodeEventsOutput(output: string): NodeEvent[] {
  const parsed = JSON.parse(output || "{}") as {
    items?: Array<{
      type?: string;
      reason?: string;
      message?: string;
      lastTimestamp?: string;
      eventTime?: string;
      firstTimestamp?: string;
      reportingController?: string;
      source?: { component?: string; host?: string };
      count?: string | number;
    }>;
  };

  return (parsed.items ?? []).map((event) => ({
    type: event.type ?? "-",
    reason: event.reason ?? "-",
    message: event.message ?? "-",
    lastTimestamp: event.lastTimestamp || event.eventTime || event.firstTimestamp || "-",
    source: event.reportingController || event.source?.component || event.source?.host || undefined,
    count: event.count,
  }));
}

export async function loadNodeEvents(clusterId: string, nodeName: string, signal?: AbortSignal) {
  const response = await kubectlRawArgsFront(buildNodeEventsArgs(nodeName), {
    clusterId,
    signal,
  });
  if (response.errors || response.code !== 0) {
    throw new Error(response.errors || `Failed to load events for node ${nodeName}.`);
  }
  return parseNodeEventsOutput(response.output || "{}");
}
