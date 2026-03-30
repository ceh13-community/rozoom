type TabWithId = { id: string };

export function orderPinnedTabs<T extends TabWithId>(tabs: T[], pinnedTabIds: Set<string>): T[] {
  const pinned = tabs.filter((tab) => pinnedTabIds.has(tab.id));
  const unpinned = tabs.filter((tab) => !pinnedTabIds.has(tab.id));
  return [...pinned, ...unpinned];
}
