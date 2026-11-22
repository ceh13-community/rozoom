import { parseKubeEvents } from "$shared/lib/kube-events";
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
  return parseKubeEvents(output);
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
