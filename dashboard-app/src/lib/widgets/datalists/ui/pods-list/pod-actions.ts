import { buildKubectlLogsArgs } from "../common/kubectl-command-builder";

type PodIdentifier = {
  name?: string;
  namespace?: string;
  container?: string;
  previous?: boolean;
  follow?: boolean;
};

export function buildPodDeleteCommand(pod: PodIdentifier): string | null {
  if (!pod.name) return null;
  const namespace = pod.namespace?.trim() || "default";
  return `delete pod ${pod.name} -n ${namespace}`;
}

export function buildPodDescribeCommand(pod: PodIdentifier): string | null {
  if (!pod.name) return null;
  const namespace = pod.namespace?.trim() || "default";
  return `describe pod ${pod.name} -n ${namespace}`;
}

export function buildPodDebugCommand(pod: PodIdentifier): string | null {
  if (!pod.name) return null;
  const namespace = pod.namespace?.trim() || "default";
  const targetArg = pod.container?.trim() ? ` --target=${pod.container.trim()}` : "";
  return `debug -it pod/${pod.name} -n ${namespace}${targetArg} --image=busybox:1.36 -- /bin/sh`;
}

export function buildPodEvictArgs(pod: PodIdentifier): string[] | null {
  if (!pod.name) return null;
  const namespace = pod.namespace?.trim() || "default";
  return ["evict", pod.name, "--namespace", namespace];
}

export function buildPodEvictFallbackDeleteArgs(pod: PodIdentifier): string[] | null {
  if (!pod.name) return null;
  const namespace = pod.namespace?.trim() || "default";
  return ["delete", "pod", pod.name, "--namespace", namespace, "--wait=false"];
}

export function buildPodLogsArgs(pod: PodIdentifier): string[] | null {
  if (!pod.name) return null;
  return buildKubectlLogsArgs({
    target: pod.name,
    namespace: pod.namespace,
    container: pod.container?.trim(),
    previous: pod.previous,
    follow: pod.follow,
  });
}

/**
 * Note for a bulk delete or evict whose pods are not all on the current page,
 * so the confirmation says the action reaches pods the user cannot see.
 */
export function describeOffPageSelection(
  podIds: string[],
  currentPageIds: string[],
): string | null {
  const onPage = new Set(currentPageIds);
  const offPageCount = podIds.filter((id) => !onPage.has(id)).length;
  if (offPageCount === 0) return null;
  const total = podIds.length;
  return `${total} pods across all pages: ${offPageCount} of them are not on the current page.`;
}

export function pruneSelection(selected: Set<string>, available: string[]): Set<string> {
  if (selected.size === 0) return selected;
  const availableSet = new Set(available);
  const next = new Set([...selected].filter((id) => availableSet.has(id)));
  if (next.size === selected.size) return selected;
  return next;
}
