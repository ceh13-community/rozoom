import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";

export type WorkloadEventsTarget = {
  resource: string;
  name: string;
  namespace?: string;
};

export type WorkloadEvent = {
  type: string;
  reason: string;
  message: string;
  lastTimestamp: string;
  source?: string;
  count?: string | number;
};

export function buildWorkloadEventsArgs(target: WorkloadEventsTarget) {
  return [
    "events",
    "--namespace",
    target.namespace ?? "default",
    "--for",
    `${target.resource}/${target.name}`,
    "-o",
    "json",
  ];
}

export function parseWorkloadEventsOutput(output: string): WorkloadEvent[] {
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

export async function loadWorkloadEvents(
  clusterId: string,
  target: WorkloadEventsTarget,
  signal?: AbortSignal,
) {
  const response = await kubectlRawArgsFront(buildWorkloadEventsArgs(target), {
    clusterId,
    signal,
  });
  if (response.errors || response.code !== 0) {
    throw new Error(response.errors || `Failed to load ${target.resource} events.`);
  }
  return parseWorkloadEventsOutput(response.output || "{}");
}
