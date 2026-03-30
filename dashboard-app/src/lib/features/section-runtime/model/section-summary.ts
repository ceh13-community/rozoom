import { getSelectedNamespaceList } from "$features/namespace-management";
import type { SectionSummaryItem, SectionSyncCacheBannerState } from "./contracts";

export function formatSectionNamespaceSummary(selectedNamespace: string) {
  const selected = getSelectedNamespaceList(selectedNamespace);
  if (selected === null) return "all";
  if (selected.length === 0) return "none";
  return selected.join(", ");
}

export function buildSectionSummaryItems(args: {
  cluster: string | null | undefined;
  selectedNamespace: string;
  rows: number;
  syncCacheState?: SectionSyncCacheBannerState | null;
}): SectionSummaryItem[] {
  const items: SectionSummaryItem[] = [
    { label: "Cluster", value: args.cluster ?? "-" },
    { label: "Namespace", value: formatSectionNamespaceSummary(args.selectedNamespace) },
    { label: "Rows", value: args.rows },
  ];
  if (args.syncCacheState) {
    items.push({ label: "Sync", value: args.syncCacheState.syncLabel });
    if (args.syncCacheState.cacheState !== "none") {
      items.push({ label: "Cache", value: args.syncCacheState.cacheLabel });
    }
  }
  return items;
}
