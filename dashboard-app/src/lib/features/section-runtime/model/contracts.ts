export type SectionRuntimeFamily = "configuration" | "network" | "storage";

export type SectionSyncState = "idle" | "loading" | "updated" | "error";
export type SectionCacheState = "none" | "miss" | "fresh" | "stale";

export type SectionSummaryItem = {
  label: string;
  value: string | number;
};

export type SectionSyncCacheBannerState = {
  syncState: SectionSyncState;
  syncLabel: string;
  cacheState: SectionCacheState;
  cacheLabel: string;
};

export type SectionDetailsBoundaryState<TRow> = {
  selectedRow: TRow | null;
  isOpen: boolean;
};

export type SectionWorkbenchBoundaryState<TRequest> = {
  request: TRequest;
  token: number;
};

export type SectionRuntimeDescriptor<TWorkloadKey extends string = string> = {
  family: SectionRuntimeFamily;
  workloadKey: TWorkloadKey;
  title: string;
  supportsSelection: boolean;
  supportsDetails: boolean;
  supportsWorkbench: boolean;
};
