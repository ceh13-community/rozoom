type WorkloadMetadata = {
  uid?: string;
  name?: string;
  namespace?: string;
  resourceVersion?: string;
};

type WorkloadListItem = {
  metadata?: WorkloadMetadata;
  status?: unknown;
};

function getItemKey(item: WorkloadListItem): string | null {
  const uid = item.metadata?.uid;
  if (uid && uid.length > 0) return `uid:${uid}`;
  const namespace = item.metadata?.namespace ?? "";
  const name = item.metadata?.name;
  if (name && name.length > 0) return `name:${namespace}:${name}`;
  return null;
}

function isItemUnchanged(previous: WorkloadListItem, next: WorkloadListItem): boolean {
  const prevRv = previous.metadata?.resourceVersion;
  const nextRv = next.metadata?.resourceVersion;
  if (prevRv && nextRv) {
    return prevRv === nextRv;
  }
  return JSON.stringify(previous.status ?? {}) === JSON.stringify(next.status ?? {});
}

export function mergeWorkloadArraySnapshot<T extends WorkloadListItem>(
  previous: T[] | null | undefined,
  next: T[],
): { merged: T[]; reusedCount: number } {
  if (!previous || previous.length === 0 || next.length === 0) {
    return { merged: next, reusedCount: 0 };
  }
  const prevByKey = new Map<string, T>();
  for (const entry of previous) {
    const key = getItemKey(entry);
    if (!key) continue;
    prevByKey.set(key, entry);
  }

  let reusedCount = 0;
  const merged = next.map((entry) => {
    const key = getItemKey(entry);
    if (!key) return entry;
    const prev = prevByKey.get(key);
    if (!prev) return entry;
    if (isItemUnchanged(prev, entry)) {
      reusedCount += 1;
      return prev;
    }
    return entry;
  });
  return { merged, reusedCount };
}
