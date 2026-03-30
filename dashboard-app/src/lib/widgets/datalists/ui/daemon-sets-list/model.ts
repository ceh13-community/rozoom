import type { DaemonSetItem } from "$shared";
import { getSelectedNamespaceList } from "$features/namespace-management";
import { buildDaemonSetProblemScore } from "../model/problem-priority";

export type DaemonSetRow = {
  uid: string;
  name: string;
  namespace: string;
  nodes: number;
  desired: number;
  current: number;
  ready: number;
  updated: number;
  available: number;
  nodeSelector: string;
  age: string;
  problemScore: number;
};

type DaemonSetStatusWithUpdated = DaemonSetItem["status"] & {
  updatedNumberScheduled?: number;
};

type RuntimeDaemonSetItem = {
  metadata?: { name?: string; namespace?: string; creationTimestamp?: string | Date };
  spec?: { template?: { spec?: { nodeSelector?: Record<string, string> } } };
  status?: Partial<DaemonSetStatusWithUpdated>;
};

export function getFilteredDaemonSets(
  items: DaemonSetItem[],
  selectedNamespace: string | null | undefined,
): DaemonSetItem[] {
  const selectedNamespaces = getSelectedNamespaceList(selectedNamespace);
  if (!selectedNamespaces) {
    return items;
  }
  const allowed = new Set(selectedNamespaces);

  return items.filter((item) => {
    const runtime = item as unknown as RuntimeDaemonSetItem;
    return allowed.has(runtime.metadata?.namespace ?? "default");
  });
}

export function formatDaemonSetNodeSelector(item: DaemonSetItem): string {
  const runtime = item as unknown as RuntimeDaemonSetItem;
  const selector = runtime.spec?.template?.spec?.nodeSelector ?? {};
  if (Object.keys(selector).length === 0) {
    return "-";
  }

  return Object.entries(selector)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

export function toDaemonSetRow(
  item: DaemonSetItem,
  getAge: (creationTimestamp: string | Date | undefined) => string,
): DaemonSetRow {
  const runtime = item as unknown as RuntimeDaemonSetItem;
  const name = runtime.metadata?.name ?? "-";
  const namespace = runtime.metadata?.namespace ?? "default";
  const status = runtime.status ?? {};

  return {
    uid: `${namespace}/${name}`,
    name,
    namespace,
    nodes: status.currentNumberScheduled ?? 0,
    desired: status.desiredNumberScheduled ?? 0,
    current: status.currentNumberScheduled ?? 0,
    ready: status.numberReady ?? 0,
    updated: status.updatedNumberScheduled ?? 0,
    available: status.numberAvailable ?? 0,
    nodeSelector: formatDaemonSetNodeSelector(item),
    age: getAge(runtime.metadata?.creationTimestamp),
    problemScore: buildDaemonSetProblemScore({
      desired: status.desiredNumberScheduled ?? 0,
      ready: status.numberReady ?? 0,
      updated: status.updatedNumberScheduled ?? 0,
      available: status.numberAvailable ?? 0,
    }),
  };
}

export function mapDaemonSetRows(
  items: DaemonSetItem[],
  getAge: (creationTimestamp: string | Date | undefined) => string,
): DaemonSetRow[] {
  return items.map((item) => toDaemonSetRow(item, getAge));
}

export function findDaemonSetItem(
  items: DaemonSetItem[],
  row: Pick<DaemonSetRow, "name" | "namespace">,
): DaemonSetItem | undefined {
  return items.find((item) => {
    const runtime = item as unknown as RuntimeDaemonSetItem;
    return (
      runtime.metadata?.name === row.name &&
      (runtime.metadata.namespace ?? "default") === row.namespace
    );
  });
}

export function pruneSelectedDaemonSetIds(
  selected: Set<string>,
  availableIds: string[],
): Set<string> {
  if (selected.size === 0) return selected;
  const available = new Set(availableIds);
  const next = new Set([...selected].filter((id) => available.has(id)));
  if (next.size === selected.size) return selected;
  return next;
}
