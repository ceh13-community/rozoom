import { computeConfigurationRows } from "../configuration-list/model/rows-query";
import type { QuickFilterId } from "../configuration-list/model/quick-filters";

type SortDirection = "asc" | "desc";

type ConfigurationWorkerRow = {
  uid: string;
  namespace: string;
  [key: string]: unknown;
};

type ConfigurationRowsWorkerRequest = {
  id: number;
  enqueuedAt: number;
  rows: ConfigurationWorkerRow[];
  selectedNamespaces: string[];
  search: string;
  quickFilter: QuickFilterId;
  sortBy: string;
  sortDirection: SortDirection;
};

type ConfigurationRowsWorkerResponse = {
  id: number;
  enqueuedAt: number;
  startedAt: number;
  finishedAt: number;
  rows: ConfigurationWorkerRow[];
};

self.onmessage = (event: MessageEvent<ConfigurationRowsWorkerRequest>) => {
  const { id, enqueuedAt, rows, selectedNamespaces, search, quickFilter, sortBy, sortDirection } =
    event.data;
  const startedAt = Date.now();
  const processed = computeConfigurationRows(rows as never[], {
    selectedNamespaces,
    search,
    quickFilter,
    sortBy,
    sortDirection,
  }) as unknown as ConfigurationWorkerRow[];
  const finishedAt = Date.now();
  const response: ConfigurationRowsWorkerResponse = {
    id,
    enqueuedAt,
    startedAt,
    finishedAt,
    rows: processed,
  };
  self.postMessage(response);
};

export {};
