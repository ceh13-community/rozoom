import type { JobItem } from "$shared/model/clusters";
import { getSelectedNamespaceList } from "$features/namespace-management";
import { buildJobProblemScore } from "../model/problem-priority";

export type JobRow = {
  uid: string;
  name: string;
  namespace: string;
  completions: string;
  age: string;
  status: string;
  problemScore: number;
};

type RuntimeJobItem = {
  metadata?: { name?: string; namespace?: string; creationTimestamp?: string | Date };
  spec?: { completions?: number };
  status?: {
    succeeded?: number;
    active?: number;
    failed?: number;
    conditions?: Array<{ type?: string; status?: string; reason?: string }>;
  };
};

function formatJobConditionStatus(item: RuntimeJobItem): string {
  const status = item.status ?? {};
  const conditions = status.conditions ?? [];
  const complete = conditions.find((condition) => condition.type === "Complete");
  if (complete && complete.status !== "False") return "Complete";

  const failed = conditions.find((condition) => condition.type === "Failed");
  if (failed && failed.status !== "False") {
    return failed.reason ? `Failed (${failed.reason})` : "Failed";
  }

  if ((status.active ?? 0) > 0) return "Running";
  if ((status.succeeded ?? 0) > 0) return "Succeeded";
  if ((status.failed ?? 0) > 0) return "Failed";

  if (conditions.length > 0 && conditions[0].type) {
    const first = conditions[0];
    const state = first.status ? ` ${first.status}` : "";
    return `${first.type}${state}`.trim();
  }

  return "-";
}

export function getFilteredJobs(
  items: JobItem[],
  selectedNamespace: string | null | undefined,
): JobItem[] {
  const selectedNamespaces = getSelectedNamespaceList(selectedNamespace);
  if (!selectedNamespaces) return items;
  const allowed = new Set(selectedNamespaces);
  return items.filter((item) => {
    const runtime = item as unknown as RuntimeJobItem;
    return allowed.has(runtime.metadata?.namespace ?? "default");
  });
}

export function toJobRow(
  item: JobItem,
  getAge: (creationTimestamp: string | Date | undefined) => string,
): JobRow {
  const runtime = item as unknown as RuntimeJobItem;
  const name = runtime.metadata?.name ?? "-";
  const namespace = runtime.metadata?.namespace ?? "default";
  const succeeded = runtime.status?.succeeded ?? 0;
  const completions = runtime.spec?.completions ?? 0;
  const status = formatJobConditionStatus(runtime);

  return {
    uid: `${namespace}/${name}`,
    name,
    namespace,
    completions: `${succeeded}/${completions}`,
    age: getAge(runtime.metadata?.creationTimestamp),
    status,
    problemScore: buildJobProblemScore({
      status,
      succeeded,
      completions,
    }),
  };
}

export function mapJobRows(
  items: JobItem[],
  getAge: (creationTimestamp: string | Date | undefined) => string,
): JobRow[] {
  return items.map((item) => toJobRow(item, getAge));
}

export function findJobItem(
  items: JobItem[],
  row: Pick<JobRow, "name" | "namespace">,
): JobItem | undefined {
  return items.find((item) => {
    const runtime = item as unknown as RuntimeJobItem;
    const metadata = runtime.metadata;
    if (!metadata) return false;
    return metadata.name === row.name && (metadata.namespace ?? "default") === row.namespace;
  });
}

export function pruneSelectedJobIds(selected: Set<string>, availableIds: string[]): Set<string> {
  if (selected.size === 0) return selected;
  const available = new Set(availableIds);
  const next = new Set([...selected].filter((id) => available.has(id)));
  if (next.size === selected.size) return selected;
  return next;
}
