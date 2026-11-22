import { parseKubeEvents } from "$shared/lib/kube-events";
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
  return parseKubeEvents(output);
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
