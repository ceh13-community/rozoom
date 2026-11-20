// Pane number for each tab shown in a visible pane, so the workbench tab strip
// says which tab sits where. No badges in a one-pane layout.
export function workbenchPaneBadges(
  paneTabIds: ReadonlyArray<string | null>,
  visiblePaneCount: number,
): Map<string, number> {
  const badges = new Map<string, number>();
  if (visiblePaneCount < 2) return badges;
  paneTabIds.slice(0, visiblePaneCount).forEach((tabId, index) => {
    if (tabId && !badges.has(tabId)) badges.set(tabId, index + 1);
  });
  return badges;
}
