import type { PortForwardProcess } from "$shared/api/port-forward";

type ForwardEntry = {
  key: string;
  forward: PortForwardProcess;
};

export function selectLatestPortForwardsByTabId<T extends ForwardEntry>(
  entries: T[],
  getTabId: (entry: T) => string,
): T[] {
  if (entries.length <= 1) return entries;
  const latestByTabId = new Map<string, T>();

  for (const entry of entries) {
    const tabId = getTabId(entry);
    const current = latestByTabId.get(tabId);
    if (!current) {
      latestByTabId.set(tabId, entry);
      continue;
    }
    const shouldReplace =
      entry.forward.startedAt > current.forward.startedAt ||
      (entry.forward.startedAt === current.forward.startedAt &&
        entry.forward.localPort > current.forward.localPort);
    if (shouldReplace) {
      latestByTabId.set(tabId, entry);
    }
  }

  return [...latestByTabId.values()];
}

export function isRunningForwardByKey(
  active: Partial<Record<string, PortForwardProcess>>,
  uniqueKey: string,
): boolean {
  const forward = active[uniqueKey];
  return Boolean(forward?.isRunning);
}
