import type { StatefulSetItem } from "$shared/model/clusters";
import { getSelectedNamespaceList } from "$features/namespace-management";
import { buildStatefulSetProblemScore } from "../model/problem-priority";

export type StatefulSetRow = {
  uid: string;
  name: string;
  namespace: string;
  pods: string;
  replicas: number;
  age: string;
  problemScore: number;
};

type RuntimeStatefulSetItem = {
  metadata?: { name?: string; namespace?: string; creationTimestamp?: string | Date };
  spec?: { replicas?: number };
  status?: { replicas?: number; readyReplicas?: number };
};

export function getFilteredStatefulSets(
  items: StatefulSetItem[],
  selectedNamespace: string | null | undefined,
): StatefulSetItem[] {
  const selectedNamespaces = getSelectedNamespaceList(selectedNamespace);
  if (!selectedNamespaces) return items;
  const allowed = new Set(selectedNamespaces);
  return items.filter((item) => {
    const runtime = item as unknown as RuntimeStatefulSetItem;
    return allowed.has(runtime.metadata?.namespace ?? "default");
  });
}

export function toStatefulSetRow(
  item: StatefulSetItem,
  getAge: (creationTimestamp: string | Date | undefined) => string,
): StatefulSetRow {
  const runtime = item as unknown as RuntimeStatefulSetItem;
  const name = runtime.metadata?.name ?? "-";
  const namespace = runtime.metadata?.namespace ?? "default";
  const replicas = runtime.status?.replicas ?? runtime.spec?.replicas ?? 0;
  const ready = runtime.status?.readyReplicas ?? 0;

  return {
    uid: `${namespace}/${name}`,
    name,
    namespace,
    pods: `${ready}/${replicas}`,
    replicas,
    age: getAge(runtime.metadata?.creationTimestamp),
    problemScore: buildStatefulSetProblemScore({ replicas, ready }),
  };
}

export function mapStatefulSetRows(
  items: StatefulSetItem[],
  getAge: (creationTimestamp: string | Date | undefined) => string,
): StatefulSetRow[] {
  return items.map((item) => toStatefulSetRow(item, getAge));
}

export function findStatefulSetItem(
  items: StatefulSetItem[],
  row: Pick<StatefulSetRow, "name" | "namespace">,
): StatefulSetItem | undefined {
  return items.find((item) => {
    const runtime = item as unknown as RuntimeStatefulSetItem;
    const metadata = runtime.metadata;
    if (!metadata) return false;
    return metadata.name === row.name && (metadata.namespace ?? "default") === row.namespace;
  });
}

export function pruneSelectedStatefulSetIds(
  selected: Set<string>,
  availableIds: string[],
): Set<string> {
  if (selected.size === 0) return selected;
  const available = new Set(availableIds);
  const next = new Set([...selected].filter((id) => available.has(id)));
  if (next.size === selected.size) return selected;
  return next;
}
