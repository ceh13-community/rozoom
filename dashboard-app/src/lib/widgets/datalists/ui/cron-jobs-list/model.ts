import type { CronJobItem } from "$shared/model/clusters";
import { getSelectedNamespaceList } from "$features/namespace-management";
import { buildCronJobProblemScore } from "../model/problem-priority";

export type CronJobRow = {
  uid: string;
  name: string;
  namespace: string;
  schedule: string;
  suspend: string;
  active: number;
  lastSchedule: string;
  nextExecution: string;
  timeZone: string;
  age: string;
  problemScore: number;
};

type RuntimeCronJobItem = {
  metadata?: { name?: string; namespace?: string; creationTimestamp?: string | Date };
  spec?: { schedule?: string; suspend?: boolean; timeZone?: string };
  status?: {
    active?: Array<{ name?: string }>;
    lastScheduleTime?: string | Date;
    nextScheduleTime?: string | Date;
    nextExecutionTime?: string | Date;
  };
};

export function getFilteredCronJobs(
  items: CronJobItem[],
  selectedNamespace: string | null | undefined,
): CronJobItem[] {
  const selectedNamespaces = getSelectedNamespaceList(selectedNamespace);
  if (!selectedNamespaces) return items;
  const allowed = new Set(selectedNamespaces);
  return items.filter((item) => {
    const runtime = item as unknown as RuntimeCronJobItem;
    return allowed.has(runtime.metadata?.namespace ?? "default");
  });
}

export function toCronJobRow(
  item: CronJobItem,
  getAge: (creationTimestamp: string | Date | undefined) => string,
  getLastScheduleAge: (lastScheduleTime: string | Date | undefined) => string,
  getNextExecutionLabel: (nextExecutionTime: string | Date | undefined) => string,
): CronJobRow {
  const runtime = item as unknown as RuntimeCronJobItem;
  const name = runtime.metadata?.name ?? "-";
  const namespace = runtime.metadata?.namespace ?? "default";
  const lastScheduleTime = runtime.status?.lastScheduleTime;
  const nextExecutionTime = runtime.status?.nextScheduleTime ?? runtime.status?.nextExecutionTime;
  const suspend = Boolean(runtime.spec?.suspend);
  const active = runtime.status?.active?.length ?? 0;
  const hasLastSchedule = Boolean(lastScheduleTime);

  return {
    uid: `${namespace}/${name}`,
    name,
    namespace,
    schedule: runtime.spec?.schedule ?? "-",
    suspend: suspend ? "Yes" : "No",
    active,
    lastSchedule: lastScheduleTime ? getLastScheduleAge(lastScheduleTime) : "-",
    nextExecution: nextExecutionTime ? getNextExecutionLabel(nextExecutionTime) : "-",
    timeZone: runtime.spec?.timeZone ?? "-",
    age: getAge(runtime.metadata?.creationTimestamp),
    problemScore: buildCronJobProblemScore({
      suspend,
      active,
      hasLastSchedule,
    }),
  };
}

export function mapCronJobRows(
  items: CronJobItem[],
  getAge: (creationTimestamp: string | Date | undefined) => string,
  getLastScheduleAge: (lastScheduleTime: string | Date | undefined) => string,
  getNextExecutionLabel: (nextExecutionTime: string | Date | undefined) => string,
): CronJobRow[] {
  return items.map((item) => toCronJobRow(item, getAge, getLastScheduleAge, getNextExecutionLabel));
}

export function findCronJobItem(
  items: CronJobItem[],
  row: Pick<CronJobRow, "name" | "namespace">,
): CronJobItem | undefined {
  return items.find((item) => {
    const runtime = item as unknown as RuntimeCronJobItem;
    const metadata = runtime.metadata;
    if (!metadata) return false;
    return metadata.name === row.name && (metadata.namespace ?? "default") === row.namespace;
  });
}

export function pruneSelectedCronJobIds(
  selected: Set<string>,
  availableIds: string[],
): Set<string> {
  if (selected.size === 0) return selected;
  const available = new Set(availableIds);
  const next = new Set([...selected].filter((id) => available.has(id)));
  if (next.size === selected.size) return selected;
  return next;
}
