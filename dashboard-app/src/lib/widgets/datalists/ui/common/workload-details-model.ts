// What a workload details panel shows next to the list: the object as the list has it now,
// and the pods that belong to it.

type Meta = { name?: string; namespace?: string; resourceVersion?: string };
type WithMeta = { metadata?: Meta };

/**
 * The list's current copy of the object the open panel shows, when it changed. The panel
 * kept the copy from the moment it opened, so its status (Pending while starting) stayed
 * while the list and the Pods block moved on. Returns null when nothing changed.
 */
export function pickLiveItem<T extends WithMeta>(current: T | null, items: readonly T[]): T | null {
  const name = current?.metadata?.name;
  if (!current || !name) return null;
  const namespace = current.metadata?.namespace ?? "";
  const live = items.find(
    (item) => item.metadata?.name === name && (item.metadata.namespace ?? "") === namespace,
  );
  if (!live || live === current) return null;
  const version = live.metadata?.resourceVersion;
  if (version && version === current.metadata?.resourceVersion) return null;
  return live;
}

type LabelSelector = {
  matchLabels?: Record<string, string>;
  matchExpressions?: Array<{ key?: string; operator?: string; values?: string[] }>;
};

/** A kubectl `-l` value for a label selector, or null when it selects nothing usable. */
export function toLabelSelectorArg(selector: LabelSelector | null | undefined): string | null {
  if (!selector) return null;
  const parts = Object.entries(selector.matchLabels ?? {}).map(([key, value]) => `${key}=${value}`);
  for (const expression of selector.matchExpressions ?? []) {
    const key = expression.key;
    const values = (expression.values ?? []).join(",");
    if (!key) continue;
    if (expression.operator === "In") parts.push(`${key} in (${values})`);
    else if (expression.operator === "NotIn") parts.push(`${key} notin (${values})`);
    else if (expression.operator === "Exists") parts.push(key);
    else if (expression.operator === "DoesNotExist") parts.push(`!${key}`);
  }
  return parts.length > 0 ? parts.join(",") : null;
}

type WorkloadLike = {
  kind?: string;
  metadata?: Meta;
  spec?: { selector?: LabelSelector };
  status?: { active?: Array<{ name?: string }> };
};

/**
 * How to find the pods of a workload: its label selector (Deployment, StatefulSet,
 * DaemonSet, ReplicaSet), or for a CronJob the pods of its running Jobs.
 */
export function workloadPodsSelector(item: WorkloadLike | null | undefined): string | null {
  if (!item) return null;
  const own = toLabelSelectorArg(item.spec?.selector);
  if (own) return own;
  const activeJobs = (item.status?.active ?? [])
    .map((job) => job.name)
    .filter((name): name is string => Boolean(name));
  return activeJobs.length > 0 ? `job-name in (${activeJobs.join(",")})` : null;
}

export type WorkloadDetailsPod = {
  name: string;
  node: string;
  namespace: string;
  ready: string;
  cpu: string;
  memory: string;
  status: string;
};

type PodJson = {
  metadata?: { name?: string; namespace?: string; deletionTimestamp?: string };
  spec?: { nodeName?: string };
  status?: {
    phase?: string;
    containerStatuses?: Array<{ ready?: boolean; state?: { waiting?: { reason?: string } } }>;
  };
};

/** `kubectl top pods --no-headers` output by pod name. */
export function parseTopPods(output: string) {
  const byPod = new Map<string, { cpu: string; memory: string }>();
  for (const line of output.split("\n")) {
    const [name, cpu, memory] = line.trim().split(/\s+/);
    if (name) byPod.set(name, { cpu: cpu || "-", memory: memory || "-" });
  }
  return byPod;
}

/** Rows for the Pods block from `kubectl get pods -o json`, with CPU and memory when known. */
export function mapWorkloadPods(
  podsJson: string,
  namespace: string,
  top: Map<string, { cpu: string; memory: string }> = new Map(),
): WorkloadDetailsPod[] {
  const parsed = JSON.parse(podsJson) as { items?: PodJson[] };
  return (parsed.items ?? []).map((pod) => {
    const statuses = pod.status?.containerStatuses ?? [];
    const name = pod.metadata?.name ?? "-";
    const waiting = statuses.find((status) => status.state?.waiting?.reason)?.state?.waiting
      ?.reason;
    return {
      name,
      node: pod.spec?.nodeName ?? "-",
      namespace: pod.metadata?.namespace ?? namespace,
      ready:
        statuses.length > 0
          ? `${statuses.filter((s) => s.ready).length} / ${statuses.length}`
          : "-",
      cpu: top.get(name)?.cpu ?? "-",
      memory: top.get(name)?.memory ?? "-",
      status: pod.metadata?.deletionTimestamp
        ? "Terminating"
        : (waiting ?? pod.status?.phase ?? "Unknown"),
    };
  });
}
