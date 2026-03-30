import type { PodItem } from "$shared/model/clusters";

export function extractPodLabels(pod: Partial<PodItem>) {
  return Object.entries(pod.metadata?.labels ?? {});
}

export function extractPodAnnotations(pod: Partial<PodItem>) {
  const metadata = (pod.metadata as Record<string, unknown> | undefined) ?? undefined;
  return Object.entries((metadata?.annotations as Record<string, string> | undefined) ?? {});
}

export function extractPodIp(pod: Partial<PodItem>) {
  const status = pod.status as { podIP?: string; podIp?: string } | undefined;
  return status?.podIP ?? status?.podIp ?? "-";
}
