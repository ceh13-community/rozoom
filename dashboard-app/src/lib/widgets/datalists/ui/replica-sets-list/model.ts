import type { ReplicaSetItem } from "$shared/model/clusters";
import { getSelectedNamespaceList } from "$features/namespace-management";
import { buildReplicaSetProblemScore } from "../model/problem-priority";

export type ReplicaSetRow = {
  uid: string;
  name: string;
  namespace: string;
  desired: number;
  current: number;
  ready: number;
  age: string;
  problemScore: number;
};

type RuntimeReplicaSetItem = {
  metadata?: { name?: string; namespace?: string; creationTimestamp?: string | Date };
  spec?: { replicas?: number };
  status?: { replicas?: number; availableReplicas?: number; readyReplicas?: number };
};

export function getFilteredReplicaSets(
  items: ReplicaSetItem[],
  selectedNamespace: string | null | undefined,
): ReplicaSetItem[] {
  const selectedNamespaces = getSelectedNamespaceList(selectedNamespace);
  if (!selectedNamespaces) return items;
  const allowed = new Set(selectedNamespaces);
  return items.filter((item) => {
    const runtime = item as unknown as RuntimeReplicaSetItem;
    return allowed.has(runtime.metadata?.namespace ?? "default");
  });
}

export function toReplicaSetRow(
  item: ReplicaSetItem,
  getAge: (creationTimestamp: string | Date | undefined) => string,
): ReplicaSetRow {
  const runtime = item as unknown as RuntimeReplicaSetItem;
  const name = runtime.metadata?.name ?? "-";
  const namespace = runtime.metadata?.namespace ?? "default";
  const spec = runtime.spec ?? {};
  const status = runtime.status ?? {};

  return {
    uid: `${namespace}/${name}`,
    name,
    namespace,
    desired: spec.replicas ?? status.replicas ?? 0,
    current: status.replicas ?? 0,
    ready: status.readyReplicas ?? 0,
    age: getAge(runtime.metadata?.creationTimestamp),
    problemScore: buildReplicaSetProblemScore({
      desired: spec.replicas ?? status.replicas ?? 0,
      current: status.replicas ?? 0,
      ready: status.readyReplicas ?? 0,
    }),
  };
}

export function mapReplicaSetRows(
  items: ReplicaSetItem[],
  getAge: (creationTimestamp: string | Date | undefined) => string,
): ReplicaSetRow[] {
  return items.map((item) => toReplicaSetRow(item, getAge));
}

export function findReplicaSetItem(
  items: ReplicaSetItem[],
  row: Pick<ReplicaSetRow, "name" | "namespace">,
): ReplicaSetItem | undefined {
  return items.find((item) => {
    const runtime = item as unknown as RuntimeReplicaSetItem;
    const metadata = runtime.metadata;
    if (!metadata) return false;
    return metadata.name === row.name && (metadata.namespace ?? "default") === row.namespace;
  });
}

export function pruneSelectedReplicaSetIds(
  selected: Set<string>,
  availableIds: string[],
): Set<string> {
  if (selected.size === 0) return selected;
  const available = new Set(availableIds);
  const next = new Set([...selected].filter((id) => available.has(id)));
  if (next.size === selected.size) return selected;
  return next;
}
