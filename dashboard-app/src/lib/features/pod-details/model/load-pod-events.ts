import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import type { PodItem } from "$shared/model/clusters";

export type PodEvent = {
  reason: string;
  type: string;
  message: string;
  count: number;
  lastTimestamp: string;
  source: string;
};

export async function loadPodEvents(clusterId: string, pod: Partial<PodItem>) {
  const podName = pod.metadata?.name;
  const namespace = pod.metadata?.namespace;
  if (!clusterId || !podName || !namespace) {
    return [] as PodEvent[];
  }

  const uid = pod.metadata?.uid;
  const fieldSelector = uid
    ? `involvedObject.uid=${uid}`
    : `involvedObject.kind=Pod,involvedObject.name=${podName}`;
  const response = await kubectlRawArgsFront(
    [
      "get",
      "events",
      "--namespace",
      namespace,
      "--field-selector",
      fieldSelector,
      "--sort-by=.lastTimestamp",
      "-o",
      "json",
    ],
    { clusterId },
  );

  if (response.errors || response.code !== 0 || !response.output) {
    throw new Error(response.errors || "Failed to load pod events.");
  }

  const parsed = JSON.parse(response.output) as {
    items?: Array<{
      type?: string;
      reason?: string;
      message?: string;
      count?: number;
      lastTimestamp?: string;
      eventTime?: string;
      firstTimestamp?: string;
      source?: { component?: string; host?: string };
    }>;
  };

  return (parsed.items ?? []).map((item) => ({
    reason: item.reason || "-",
    type: item.type || "-",
    message: item.message || "-",
    count: item.count ?? 1,
    lastTimestamp: item.lastTimestamp || item.eventTime || item.firstTimestamp || "-",
    source: item.source?.component || item.source?.host || "-",
  }));
}
