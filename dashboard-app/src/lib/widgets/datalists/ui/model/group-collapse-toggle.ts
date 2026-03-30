export function areAllGroupsCollapsed(collapsedGroups: Set<string>, groupIds: string[]) {
  if (groupIds.length === 0) return false;
  return groupIds.every((id) => collapsedGroups.has(id));
}

export function toggleAllGroupsCollapsed(collapsedGroups: Set<string>, groupIds: string[]) {
  const next = new Set(collapsedGroups);
  const allCollapsed = areAllGroupsCollapsed(collapsedGroups, groupIds);
  if (allCollapsed) {
    for (const id of groupIds) next.delete(id);
    return next;
  }
  for (const id of groupIds) next.add(id);
  return next;
}

export function getGroupCollapseToggleLabel(collapsedGroups: Set<string>, groupIds: string[]) {
  return areAllGroupsCollapsed(collapsedGroups, groupIds) ? "Expand all" : "Collapse all";
}
