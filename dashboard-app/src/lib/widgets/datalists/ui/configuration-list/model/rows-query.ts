import {
  applyResourceQuery,
  parseResourceQuery,
} from "$features/workloads-management/model/resource-query";
import { applyQuickFilterRows, type QuickFilterId } from "./quick-filters";

type SortDirection = "asc" | "desc";

type ConfigurationLikeRow = {
  name: string;
  namespace: string;
  problemScore: number;
  keys: number;
  labels: string;
  globalDefault: boolean;
  type: string;
  handler: string;
  holder: string;
  webhooks: number;
  status: string;
  minAvailable: string;
  maxUnavailable: string;
  currentHealthy: number;
  desiredHealthy: number;
  metrics: number;
  minPods: number;
  maxPods: number;
  replicas: string;
  bindings: string;
  resource: string;
  group: string;
  version: string;
  scope: string;
  kind: string;
  controller: string;
  apiGroup: string;
  externalIP: string;
  selector: string;
  endpoints: string;
  loadBalancers: string;
  policyTypes: string;
  storageClass: string;
  size: string;
  pods: string;
  capacity: string;
  value: string;
  resourceVersion: string;
  serviceType: string;
  clusterIP: string;
  ports: string | number;
  phase: string;
  storage: string;
  claim: string;
  provisioner: string;
  reclaimPolicy: string;
  isDefaultStorageClass: boolean;
  createdAt: string;
  details: string;
  driftDetected: boolean;
};

type SortableValue = string | number;

type ComputeRowsOptions = {
  selectedNamespaces: string[];
  search: string;
  quickFilter: QuickFilterId;
  sortBy: string;
  sortDirection: SortDirection;
};

function sortableText(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase();
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value).toLowerCase();
  }
  if (value == null) return "";
  return "";
}

function getSortValue(row: ConfigurationLikeRow, sortBy: string): SortableValue {
  if (sortBy === "problemScore") return row.problemScore;
  if (sortBy === "keys") return row.keys;
  if (sortBy === "labels") return sortableText(row.labels);
  if (sortBy === "globalDefault") return Number(row.globalDefault);
  if (sortBy === "type") return sortableText(row.type);
  if (sortBy === "handler") return sortableText(row.handler);
  if (sortBy === "holder") return sortableText(row.holder);
  if (sortBy === "webhooks") return row.webhooks;
  if (sortBy === "status") return sortableText(row.status);
  if (sortBy === "minAvailable") return sortableText(row.minAvailable);
  if (sortBy === "maxUnavailable") return sortableText(row.maxUnavailable);
  if (sortBy === "currentHealthy") return row.currentHealthy;
  if (sortBy === "desiredHealthy") return row.desiredHealthy;
  if (sortBy === "metrics") return row.metrics;
  if (sortBy === "minPods") return row.minPods;
  if (sortBy === "maxPods") return row.maxPods;
  if (sortBy === "replicas") return sortableText(row.replicas);
  if (sortBy === "bindings") return sortableText(row.bindings);
  if (sortBy === "resource") return sortableText(row.resource);
  if (sortBy === "group") return sortableText(row.group);
  if (sortBy === "version") return sortableText(row.version);
  if (sortBy === "scope") return sortableText(row.scope);
  if (sortBy === "kind") return sortableText(row.kind);
  if (sortBy === "controller") return sortableText(row.controller);
  if (sortBy === "apiGroup") return sortableText(row.apiGroup);
  if (sortBy === "externalIP") return sortableText(row.externalIP);
  if (sortBy === "selector") return sortableText(row.selector);
  if (sortBy === "endpoints") return sortableText(row.endpoints);
  if (sortBy === "loadBalancers") return sortableText(row.loadBalancers);
  if (sortBy === "policyTypes") return sortableText(row.policyTypes);
  if (sortBy === "storageClass") return sortableText(row.storageClass);
  if (sortBy === "size") return sortableText(row.size);
  if (sortBy === "pods") return sortableText(row.pods);
  if (sortBy === "capacity") return sortableText(row.capacity);
  if (sortBy === "value") return sortableText(row.value);
  if (sortBy === "resourceVersion") return sortableText(row.resourceVersion);
  if (sortBy === "serviceType") return sortableText(row.serviceType);
  if (sortBy === "clusterIP") return sortableText(row.clusterIP);
  if (sortBy === "ports") return sortableText(row.ports);
  if (sortBy === "phase") return sortableText(row.phase);
  if (sortBy === "storage") return sortableText(row.storage);
  if (sortBy === "claim") return sortableText(row.claim);
  if (sortBy === "provisioner") return sortableText(row.provisioner);
  if (sortBy === "reclaimPolicy") return sortableText(row.reclaimPolicy);
  if (sortBy === "isDefaultStorageClass") return Number(row.isDefaultStorageClass);
  if (sortBy === "createdAt") return Date.parse(row.createdAt || "1970-01-01T00:00:00Z");
  return sortableText((row as Record<string, unknown>)[sortBy]);
}

function compareRows(
  sortBy: string,
  sortDirection: SortDirection,
  left: ConfigurationLikeRow,
  right: ConfigurationLikeRow,
) {
  const dir = sortDirection === "asc" ? 1 : -1;
  const leftValue = getSortValue(left, sortBy);
  const rightValue = getSortValue(right, sortBy);

  if (leftValue < rightValue) return -1 * dir;
  if (leftValue > rightValue) return 1 * dir;
  if (sortBy !== "name") {
    const leftName = sortableText(left.name);
    const rightName = sortableText(right.name);
    if (leftName < rightName) return -1;
    if (leftName > rightName) return 1;
  }
  const leftNamespace = sortableText(left.namespace);
  const rightNamespace = sortableText(right.namespace);
  if (leftNamespace < rightNamespace) return -1;
  if (leftNamespace > rightNamespace) return 1;
  return 0;
}

function toSearchText(row: ConfigurationLikeRow) {
  return `${row.name} ${row.namespace} ${row.details} ${row.type} ${row.value} ${row.resourceVersion} ${row.labels} ${row.handler} ${row.holder} ${row.webhooks} ${row.status} ${row.minAvailable} ${row.maxUnavailable} ${row.currentHealthy} ${row.desiredHealthy} ${row.metrics} ${row.minPods} ${row.maxPods} ${row.replicas} ${row.bindings} ${row.resource} ${row.group} ${row.version} ${row.scope} ${row.kind} ${row.controller} ${row.apiGroup} ${row.externalIP} ${row.selector} ${row.endpoints} ${row.loadBalancers} ${row.policyTypes} ${row.storageClass} ${row.size} ${row.pods} ${row.capacity} ${row.serviceType} ${row.clusterIP} ${row.phase} ${row.storage} ${row.claim} ${row.provisioner} ${row.reclaimPolicy} ${row.driftDetected ? "drift" : ""}`;
}

export function computeConfigurationRows<T extends ConfigurationLikeRow>(
  rows: T[],
  options: ComputeRowsOptions,
): T[] {
  const parser = parseResourceQuery(options.search);
  const selectedNamespaces = new Set(options.selectedNamespaces);
  const scoped = rows.filter((row) => selectedNamespaces.has(row.namespace));
  const queried = applyResourceQuery(scoped, parser, toSearchText);
  const quickFiltered = applyQuickFilterRows(
    queried as unknown as Parameters<typeof applyQuickFilterRows>[0],
    options.quickFilter,
  ) as unknown as T[];
  return [...quickFiltered].sort((left, right) =>
    compareRows(options.sortBy, options.sortDirection, left, right),
  );
}
