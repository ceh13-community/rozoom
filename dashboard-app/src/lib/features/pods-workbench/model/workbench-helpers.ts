export function computeLayoutClosePlan(
  paneTabIds: [string | null, string | null, string | null],
  nextPaneCount: number,
) {
  const removedPaneIndexes = paneTabIds
    .map((tabId, index) => ({ tabId, index }))
    .filter((item) => item.index >= nextPaneCount);
  const retainedPaneTabIds = new Set(
    paneTabIds.slice(0, nextPaneCount).filter((id): id is string => Boolean(id)),
  );
  const occupiedRemovedPaneCount = removedPaneIndexes.filter((item) => Boolean(item.tabId)).length;
  const tabsToClose = Array.from(
    new Set(
      removedPaneIndexes
        .map((item) => item.tabId)
        .filter((id): id is string => Boolean(id))
        .filter((id) => !retainedPaneTabIds.has(id)),
    ),
  );

  return {
    occupiedRemovedPaneCount,
    tabsToClose,
  };
}

export function formatApplyErrorMessage(rawError: string, podRef: string) {
  if (/pod updates may not change fields other than/i.test(rawError)) {
    return `Kubernetes blocks direct updates to most Pod fields for ${podRef}. Edit the owning Deployment/StatefulSet/DaemonSet, or recreate the Pod.\n\n${rawError}`;
  }
  return rawError || "Failed to apply YAML.";
}
