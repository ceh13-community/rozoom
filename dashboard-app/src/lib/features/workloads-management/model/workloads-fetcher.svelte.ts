import type { WorkloadOverview, WorkloadsType } from "$shared/model/workloads";
import { kubectlJson, kubectlRawFront } from "$shared/api/kubectl-proxy";
import { KUBECTL_COMMANDS } from "$shared/config/kubectl-commands";
import type { KubectlOptions } from "$shared/model/kubectl";
import type { WorkloadData, WorkloadType } from "$shared/model/workloads";
import type { PodItem } from "$shared/model/clusters";
import { EMPTY_NAMESPACE_SELECTION } from "$features/namespace-management";
import { workloadRequestScheduler } from "$shared/lib/request-scheduler";
import { evaluateWorkloadPerfBudgets, trackWorkloadEvent } from "./workload-telemetry";
import { mergeWorkloadArraySnapshot } from "./merge-workload-array-snapshot";

interface WorkloadsFetcherState {
  data: WorkloadData["items"] | WorkloadOverview | null;
  isLoading: boolean;
  error: string | null;
  cache: {
    state: "miss" | "fresh" | "stale";
    cachedAt: number | null;
    ageMs: number | null;
  };
}

interface FetchParams {
  workloadType: WorkloadType;
  namespace: string;
  clusterUuid: string;
  sortField?: string;
}

type WorkloadsPayload = WorkloadData["items"] | WorkloadOverview;

type WorkloadsCacheEntry = {
  schemaVersion: 1;
  cachedAt: number;
  data: WorkloadsPayload;
  bytes: number;
};

interface SortableItem {
  metadata: {
    name: string;
    createdAt?: Date;
    updatedAt?: Date;
  };
}

type NamespaceScope = {
  mode: "all" | "none" | "single" | "multi";
  namespaces: string[];
  kubectlNamespaceArg: string;
};

const MULTI_NAMESPACE_SCOPED_WORKLOADS = new Set<WorkloadType>([
  "overview",
  "pods",
  "deployments",
  "daemonsets",
  "statefulsets",
  "replicasets",
  "replicationcontrollers",
  "jobs",
  "cronjobs",
  "podsrestarts",
  "configmaps",
  "secrets",
  "resourcequotas",
  "limitranges",
  "horizontalpodautoscalers",
  "poddisruptionbudgets",
  "leases",
  "serviceaccounts",
  "roles",
  "rolebindings",
  "services",
  "endpoints",
  "endpointslices",
  "ingresses",
  "networkpolicies",
  "persistentvolumeclaims",
  "volumesnapshots",
  "csistoragecapacities",
  "gateways",
  "httproutes",
  "referencegrants",
]);

const WORKLOADS_CACHE_SCHEMA_VERSION = 1;
const WORKLOADS_CACHE_TTL_MS = 5 * 60 * 1000;
const WORKLOADS_CACHE_MAX_STALE_MS = 24 * 60 * 60 * 1000;
const WORKLOADS_CACHE_STORAGE_PREFIX = "dashboard.workloads.cache.v1";
const WORKLOADS_CACHE_MAX_ENTRIES = 220;
const WORKLOADS_CACHE_MAX_BYTES = 3_500_000;
const WORKLOADS_MEMORY_CACHE_MAX_ENTRIES = 48;
const WORKLOADS_MEMORY_CACHE_MAX_BYTES = 12_000_000;
const workloadsCacheMemory = new Map<string, WorkloadsCacheEntry>();
const workloadsInFlightRequests = new Map<string, Promise<WorkloadsPayload>>();
const LOCAL_ONLY_WORKLOADS: WorkloadType[] = [
  "deprecationscan",
  "versionaudit",
  "backupaudit",
  "alertshub",
  "armorhub",
  "metricssources",
  "compliancehub",
  "trivyhub",
  "helm",
  "portforwarding",
  "accessreviews",
  "globaltriage",
];

function isLocalOnlyWorkload(workloadType: WorkloadType) {
  return LOCAL_ONLY_WORKLOADS.includes(workloadType);
}

function normalizeCacheSegment(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function buildCacheKey(
  workloadType: WorkloadType,
  namespace: string,
  clusterUuid: string,
  sortField?: string,
) {
  const cluster = normalizeCacheSegment(clusterUuid, "unknown-cluster");
  const workload = normalizeCacheSegment(workloadType, "overview");
  const ns = normalizeCacheSegment(namespace, "all");
  const sort = normalizeCacheSegment(sortField, "none");
  return [cluster, workload, ns, sort].join("::");
}

function buildStorageKey(cacheKey: string) {
  return `${WORKLOADS_CACHE_STORAGE_PREFIX}:${encodeURIComponent(cacheKey)}`;
}

function decodeStorageCacheKey(storageKey: string): string | null {
  const prefix = `${WORKLOADS_CACHE_STORAGE_PREFIX}:`;
  if (!storageKey.startsWith(prefix)) return null;
  const encoded = storageKey.slice(prefix.length);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

class WorkloadsFetcher {
  private state = $state<WorkloadsFetcherState>({
    data: null,
    isLoading: false,
    error: null,
    cache: {
      state: "miss",
      cachedAt: null,
      ageMs: null,
    },
  });

  private lastFetchParams: FetchParams | null = null;
  private abortController: AbortController | null = null;
  private readonly OVERVIEW_REQUEST_TIMEOUT = "8s";

  private estimateCacheEntryBytes(snapshot: {
    schemaVersion: 1;
    cachedAt: number;
    data: WorkloadsPayload;
  }): number {
    try {
      return JSON.stringify(snapshot).length;
    } catch {
      return 1;
    }
  }

  private getCacheKey(
    workloadType: WorkloadType,
    namespace: string,
    clusterUuid: string,
    sortField?: string,
  ) {
    return buildCacheKey(workloadType, namespace, clusterUuid, sortField);
  }

  private getStorageKey(cacheKey: string) {
    return buildStorageKey(cacheKey);
  }

  private trimMemoryCache() {
    let totalBytes = 0;
    for (const entry of workloadsCacheMemory.values()) {
      totalBytes += Math.max(1, entry.bytes);
    }
    if (
      workloadsCacheMemory.size <= WORKLOADS_MEMORY_CACHE_MAX_ENTRIES &&
      totalBytes <= WORKLOADS_MEMORY_CACHE_MAX_BYTES
    ) {
      return;
    }

    const entries = [...workloadsCacheMemory.entries()]
      .map(([key, value]) => ({ key, cachedAt: value.cachedAt, bytes: Math.max(1, value.bytes) }))
      .sort((left, right) => right.cachedAt - left.cachedAt);

    const stale: Array<{ key: string; cachedAt: number; bytes: number }> = [];
    let keptEntries = entries.length;
    for (const entry of entries) {
      const exceedsEntryLimit = keptEntries > WORKLOADS_MEMORY_CACHE_MAX_ENTRIES;
      const exceedsByteLimit = totalBytes > WORKLOADS_MEMORY_CACHE_MAX_BYTES;
      if (!exceedsEntryLimit && !exceedsByteLimit) break;
      stale.push(entry);
      keptEntries -= 1;
      totalBytes -= entry.bytes;
    }

    if (stale.length === 0) return;
    for (const entry of stale) {
      workloadsCacheMemory.delete(entry.key);
    }
    trackWorkloadEvent("workloads.cache_memory_evict", {
      removed: stale.length,
      remaining: workloadsCacheMemory.size,
      reason: entries.length > WORKLOADS_MEMORY_CACHE_MAX_ENTRIES ? "max_entries" : "max_bytes",
      bytes: Math.max(0, totalBytes),
    });
  }

  private cleanupPersistedCache() {
    if (typeof window === "undefined") return;
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key) continue;
      if (key.startsWith(`${WORKLOADS_CACHE_STORAGE_PREFIX}:`)) {
        keys.push(key);
      }
    }
    if (keys.length === 0) return;

    const entries: Array<{ key: string; cachedAt: number; bytes: number }> = [];
    let totalBytes = 0;
    for (const key of keys) {
      const raw = window.localStorage.getItem(key);
      const parsed = this.parseCacheEntry(raw, true, decodeStorageCacheKey(key) ?? undefined);
      if (!parsed) {
        window.localStorage.removeItem(key);
        continue;
      }
      const bytes = raw?.length ?? 0;
      totalBytes += bytes;
      entries.push({ key, cachedAt: parsed.cachedAt, bytes });
    }
    if (entries.length <= WORKLOADS_CACHE_MAX_ENTRIES && totalBytes <= WORKLOADS_CACHE_MAX_BYTES) {
      return;
    }
    entries.sort((left, right) => right.cachedAt - left.cachedAt);
    for (const stale of entries.slice(WORKLOADS_CACHE_MAX_ENTRIES)) {
      totalBytes -= stale.bytes;
      window.localStorage.removeItem(stale.key);
    }
    if (totalBytes <= WORKLOADS_CACHE_MAX_BYTES) return;
    for (const stale of entries.slice(0, WORKLOADS_CACHE_MAX_ENTRIES).reverse()) {
      if (totalBytes <= WORKLOADS_CACHE_MAX_BYTES) break;
      totalBytes -= stale.bytes;
      window.localStorage.removeItem(stale.key);
    }
  }

  private isCacheEntryFresh(entry: WorkloadsCacheEntry): boolean {
    if (!Number.isFinite(entry.cachedAt)) return false;
    return Date.now() - entry.cachedAt <= WORKLOADS_CACHE_TTL_MS;
  }

  private parseCacheEntry(
    raw: string | null,
    allowStale = false,
    cacheKey?: string,
  ): WorkloadsCacheEntry | null {
    if (!raw) return null;
    try {
      const parseStartedAt = Date.now();
      const parsed = JSON.parse(raw) as Partial<WorkloadsCacheEntry>;
      const deserializeMs = Date.now() - parseStartedAt;
      if (deserializeMs > 10) {
        trackWorkloadEvent("workloads.cache_deserialize_ms", {
          cacheKey,
          durationMs: deserializeMs,
          allowStale,
        });
      }
      if (parsed.schemaVersion !== WORKLOADS_CACHE_SCHEMA_VERSION) return null;
      const cachedAt = parsed.cachedAt;
      if (typeof cachedAt !== "number" || !Number.isFinite(cachedAt)) return null;
      const ageMs = Date.now() - cachedAt;
      if (ageMs > WORKLOADS_CACHE_MAX_STALE_MS) return null;
      if (!allowStale && ageMs > WORKLOADS_CACHE_TTL_MS) return null;
      if (parsed.data == null) return null;
      if (!Array.isArray(parsed.data) && typeof parsed.data !== "object") return null;
      return {
        schemaVersion: WORKLOADS_CACHE_SCHEMA_VERSION,
        cachedAt,
        data: parsed.data as WorkloadsPayload,
        bytes: Math.max(1, raw.length),
      };
    } catch {
      return null;
    }
  }

  private loadCachedData(
    cacheKey: string,
  ): { data: WorkloadsPayload; fresh: boolean; cachedAt: number } | null {
    const inMemory = workloadsCacheMemory.get(cacheKey);
    if (inMemory) {
      const fresh = this.isCacheEntryFresh(inMemory);
      const ageMs = Math.max(0, Date.now() - inMemory.cachedAt);
      if (ageMs <= WORKLOADS_CACHE_MAX_STALE_MS) {
        this.trimMemoryCache();
        return { data: inMemory.data, fresh, cachedAt: inMemory.cachedAt };
      }
      workloadsCacheMemory.delete(cacheKey);
    }
    if (typeof window === "undefined") return null;
    try {
      const parsed = this.parseCacheEntry(
        window.localStorage.getItem(this.getStorageKey(cacheKey)),
        true,
        cacheKey,
      );
      if (!parsed) return null;
      workloadsCacheMemory.set(cacheKey, parsed);
      this.trimMemoryCache();
      return {
        data: parsed.data,
        fresh: this.isCacheEntryFresh(parsed),
        cachedAt: parsed.cachedAt,
      };
    } catch {
      return null;
    }
  }

  private persistCachedData(cacheKey: string, data: WorkloadsPayload) {
    const snapshotBase: Pick<WorkloadsCacheEntry, "schemaVersion" | "cachedAt" | "data"> = {
      schemaVersion: WORKLOADS_CACHE_SCHEMA_VERSION,
      cachedAt: Date.now(),
      data,
    };
    const snapshot: WorkloadsCacheEntry = {
      ...snapshotBase,
      bytes: this.estimateCacheEntryBytes(snapshotBase),
    };
    workloadsCacheMemory.set(cacheKey, snapshot);
    this.trimMemoryCache();
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(this.getStorageKey(cacheKey), JSON.stringify(snapshot));
      this.cleanupPersistedCache();
    } catch {
      // ignore storage errors
    }
  }

  private requestSharedData(
    cacheKey: string,
    workloadType: WorkloadType,
    clusterUuid: string,
    namespace: string,
    sortField?: string,
    priority = 0,
    signal?: AbortSignal,
  ): Promise<WorkloadsPayload> {
    const inFlight = workloadsInFlightRequests.get(cacheKey);
    if (inFlight) {
      trackWorkloadEvent("workloads.request_deduped", {
        cacheKey,
        workloadType,
        clusterUuid,
      });
      return inFlight;
    }
    const scheduledAt = Date.now();
    const request = workloadRequestScheduler
      .schedule(
        async () => {
          const waitMs = Date.now() - scheduledAt;
          if (waitMs > 25) {
            trackWorkloadEvent("workloads.scheduler_wait_ms", {
              workloadType,
              clusterUuid,
              durationMs: waitMs,
              waitMs,
              active: workloadRequestScheduler.getActiveCount(),
              queued: workloadRequestScheduler.getQueuedCount(),
            });
          }
          return this.fetchWorkloadData(workloadType, clusterUuid, namespace, sortField, signal);
        },
        { priority },
      )
      .finally(() => {
        if (workloadsInFlightRequests.get(cacheKey) === request) {
          workloadsInFlightRequests.delete(cacheKey);
        }
      });
    workloadsInFlightRequests.set(cacheKey, request);
    return request;
  }

  get data() {
    return this.state.data;
  }

  get isLoading() {
    return this.state.isLoading;
  }

  get error() {
    return this.state.error;
  }

  get cache() {
    return this.state.cache;
  }

  private mergePayload(nextData: WorkloadsPayload): WorkloadsPayload {
    const prevData = this.state.data;
    if (!Array.isArray(prevData) || !Array.isArray(nextData)) {
      return nextData;
    }
    const merged = mergeWorkloadArraySnapshot(
      prevData as Array<{
        metadata?: { uid?: string; name?: string; namespace?: string; resourceVersion?: string };
        status?: unknown;
      }>,
      nextData as Array<{
        metadata?: { uid?: string; name?: string; namespace?: string; resourceVersion?: string };
        status?: unknown;
      }>,
    );
    if (merged.reusedCount > 0) {
      trackWorkloadEvent("workloads.incremental_merge", {
        reusedCount: merged.reusedCount,
        totalCount: nextData.length,
      });
    }
    return merged.merged as WorkloadsPayload;
  }

  private resolveNamespaceScope(namespace: string): NamespaceScope {
    if (!namespace || namespace === "all") {
      return { mode: "all", namespaces: [], kubectlNamespaceArg: "--all-namespaces" };
    }
    if (namespace === EMPTY_NAMESPACE_SELECTION) {
      return { mode: "none", namespaces: [], kubectlNamespaceArg: "--all-namespaces" };
    }

    const namespaces = Array.from(
      new Set(
        namespace
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );

    if (namespaces.length === 0) {
      return { mode: "none", namespaces: [], kubectlNamespaceArg: "--all-namespaces" };
    }
    if (namespaces.length === 1) {
      return { mode: "single", namespaces, kubectlNamespaceArg: `-n ${namespaces[0]}` };
    }
    return { mode: "multi", namespaces, kubectlNamespaceArg: "--all-namespaces" };
  }

  private filterItemsByNamespaces(
    items: unknown[] | undefined,
    namespaces: string[],
    enabled: boolean,
  ): unknown[] {
    if (!Array.isArray(items)) return [];
    if (!enabled || namespaces.length === 0) return items;
    const allowed = new Set(namespaces);
    return items.filter((item) => {
      if (!item || typeof item !== "object") return false;
      const ns = (item as { metadata?: { namespace?: string } }).metadata?.namespace;
      return typeof ns === "string" && allowed.has(ns);
    });
  }

  private countRows(output: string): number {
    if (!output) return 0;
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean).length;
  }

  private buildOverviewResourceQuery(scope: NamespaceScope): string {
    const resources = "pods,deployments,daemonsets,statefulsets,replicasets,jobs,cronjobs";
    const scopeArg = scope.mode === "single" ? scope.kubectlNamespaceArg : "--all-namespaces";
    return `get ${resources} ${scopeArg} --request-timeout=${this.OVERVIEW_REQUEST_TIMEOUT} --no-headers -o custom-columns=KIND:.kind,NAMESPACE:.metadata.namespace,NAME:.metadata.name`;
  }

  private countOverviewResourcesFromOutput(
    output: string,
    scope: NamespaceScope,
  ): Partial<Record<WorkloadsType, number>> {
    const counts: Partial<Record<WorkloadsType, number>> = {
      pods: 0,
      deployments: 0,
      daemonsets: 0,
      statefulsets: 0,
      replicasets: 0,
      jobs: 0,
      cronjobs: 0,
    };
    if (!output) return counts;

    const allowedNamespaces = scope.mode === "multi" ? new Set(scope.namespaces) : null;
    for (const rawLine of output.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 3) continue;
      const [rawKind, namespace] = parts;
      if (allowedNamespaces && !allowedNamespaces.has(namespace)) continue;
      const kind = rawKind.toLowerCase();
      if (kind === "pod") counts.pods = (counts.pods ?? 0) + 1;
      else if (kind === "deployment") counts.deployments = (counts.deployments ?? 0) + 1;
      else if (kind === "daemonset") counts.daemonsets = (counts.daemonsets ?? 0) + 1;
      else if (kind === "statefulset") counts.statefulsets = (counts.statefulsets ?? 0) + 1;
      else if (kind === "replicaset") counts.replicasets = (counts.replicasets ?? 0) + 1;
      else if (kind === "job") counts.jobs = (counts.jobs ?? 0) + 1;
      else if (kind === "cronjob") counts.cronjobs = (counts.cronjobs ?? 0) + 1;
    }

    return counts;
  }

  private async countOverviewResource(
    resource: WorkloadsType,
    scope: NamespaceScope,
    options: KubectlOptions,
    signal?: AbortSignal,
  ): Promise<number> {
    const abortableOptions = signal ? { ...options, signal } : options;
    if (resource === "nodes") {
      const result = await kubectlRawFront(
        `get nodes --request-timeout=${this.OVERVIEW_REQUEST_TIMEOUT} --no-headers -o custom-columns=NAME:.metadata.name`,
        abortableOptions,
      );
      if (result.errors || result.code !== 0) return 0;
      return this.countRows(result.output);
    }

    if (scope.mode === "none") return 0;

    const scopeArg = scope.mode === "single" ? scope.kubectlNamespaceArg : "--all-namespaces";
    const columns =
      scope.mode === "multi" ? "NS:.metadata.namespace,NAME:.metadata.name" : "NAME:.metadata.name";
    const result = await kubectlRawFront(
      `get ${resource} ${scopeArg} --request-timeout=${this.OVERVIEW_REQUEST_TIMEOUT} --no-headers -o custom-columns=${columns}`,
      abortableOptions,
    );
    if (result.errors || result.code !== 0) return 0;
    if (scope.mode !== "multi") {
      return this.countRows(result.output);
    }
    if (!result.output) return 0;
    const allowed = new Set(scope.namespaces);
    return result.output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => {
        const namespaceToken = line.split(/\s+/, 1)[0];
        return allowed.has(namespaceToken);
      }).length;
  }

  private async fetchOverview(
    clusterUuid: string,
    namespace: string,
    signal?: AbortSignal,
  ): Promise<WorkloadOverview> {
    const scope = this.resolveNamespaceScope(namespace);
    const options: KubectlOptions = { clusterId: clusterUuid };

    const quantities: Record<WorkloadsType, number> = {
      pods: 0,
      deployments: 0,
      daemonsets: 0,
      statefulsets: 0,
      replicasets: 0,
      jobs: 0,
      cronjobs: 0,
      nodes: 0,
    };
    const abortableOptions = signal ? { ...options, signal } : options;

    try {
      const combinedResult = await kubectlRawFront(
        this.buildOverviewResourceQuery(scope),
        abortableOptions,
      );
      if (!combinedResult.errors && combinedResult.code === 0) {
        Object.assign(
          quantities,
          this.countOverviewResourcesFromOutput(combinedResult.output, scope),
        );
      }
    } catch (error) {
      console.warn("Failed to fetch overview resources:", error);
    }

    try {
      quantities.nodes = await this.countOverviewResource("nodes", scope, options, signal);
    } catch (error) {
      console.warn("Failed to fetch nodes overview:", error);
      quantities.nodes = 0;
    }

    return {
      pods: { quantity: quantities.pods },
      deployments: { quantity: quantities.deployments },
      daemonsets: { quantity: quantities.daemonsets },
      statefulsets: { quantity: quantities.statefulsets },
      replicasets: { quantity: quantities.replicasets },
      jobs: { quantity: quantities.jobs },
      cronjobs: { quantity: quantities.cronjobs },
      nodes: { quantity: quantities.nodes },
    };
  }

  private async fetchWorkloadData(
    workloadType: WorkloadType,
    clusterUuid: string,
    namespace: string,
    sortField?: string,
    signal?: AbortSignal,
  ): Promise<WorkloadData["items"] | WorkloadOverview> {
    if (isLocalOnlyWorkload(workloadType)) {
      return [];
    }

    if (workloadType === "overview") {
      return this.fetchOverview(clusterUuid, namespace, signal);
    }

    const scope = this.resolveNamespaceScope(namespace);
    if (scope.mode === "none" && MULTI_NAMESPACE_SCOPED_WORKLOADS.has(workloadType)) {
      return [];
    }

    const ns = scope.kubectlNamespaceArg;
    const command = KUBECTL_COMMANDS[workloadType].replace("${ns}", ns);
    if (!command) return [];
    const options: KubectlOptions = {
      clusterId: clusterUuid,
      signal,
    };

    try {
      const response = await kubectlJson<WorkloadData>(command, options);

      if (typeof response !== "object") {
        throw new Error(response);
      }

      let items: WorkloadData["items"] = response.items;
      if (scope.mode === "multi" && MULTI_NAMESPACE_SCOPED_WORKLOADS.has(workloadType)) {
        items = this.filterItemsByNamespaces(
          response.items as unknown[],
          scope.namespaces,
          true,
        ) as WorkloadData["items"];
      }

      if (sortField && this.isSortable(items)) {
        return this.sortByField(items, sortField) as WorkloadData["items"];
      }

      return items;
    } catch (error) {
      throw new Error(`Failed to fetch ${workloadType}: ${error}`);
    }
  }

  private shouldFetch(
    workloadType: WorkloadType,
    namespace: string,
    clusterUuid: string,
    sortField?: string,
    force = false,
  ): boolean {
    if (force) return true;
    if (!this.lastFetchParams) return true;

    const {
      workloadType: lastType,
      namespace: lastNs,
      clusterUuid: lastCluster,
      sortField: lastSortField,
    } = this.lastFetchParams;
    return !(
      lastType === workloadType &&
      lastNs === namespace &&
      lastCluster === clusterUuid &&
      (lastSortField ?? undefined) === (sortField ?? undefined)
    );
  }

  protected isSortable(data: unknown): data is SortableItem[] {
    return (
      Array.isArray(data) &&
      data.length > 0 &&
      data.every((item: SortableItem) => typeof item.metadata.name === "string")
    );
  }

  protected sortByField(
    items: Array<{ metadata: { name: string } }>,
    sortField: string,
  ): Array<{ metadata: { name: string } }> {
    const sortedItems = [...items];

    switch (sortField) {
      case "name":
        return sortedItems.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
      case "restarts":
        return this.sortByRestarts(sortedItems as unknown as PodItem[]);
      default:
        return sortedItems;
    }
  }

  protected sortByRestarts(items: PodItem[]): PodItem[] {
    return items.sort((a, b) => {
      const aRestarts = a.status.containerStatuses?.[0]?.restartCount || 0;
      const bRestarts = b.status.containerStatuses?.[0]?.restartCount || 0;
      return bRestarts - aRestarts;
    });
  }

  async fetchWorkloads(
    workloadType: WorkloadType,
    namespace: string,
    clusterUuid: string,
    sortField?: string,
    force = false,
    mode: "foreground" | "prefetch" = "foreground",
  ): Promise<void> {
    if (!this.shouldFetch(workloadType, namespace, clusterUuid, sortField, force)) {
      return;
    }

    const cacheKey = this.getCacheKey(workloadType, namespace, clusterUuid, sortField);
    if (!force) {
      const cached = this.loadCachedData(cacheKey);
      if (cached) {
        this.state.data = cached.data;
        const ageMs = Math.max(0, Date.now() - cached.cachedAt);
        this.state.cache = {
          state: cached.fresh ? "fresh" : "stale",
          cachedAt: cached.cachedAt,
          ageMs,
        };
        trackWorkloadEvent("workloads.cache_hit", {
          cacheKey,
          workloadType,
          clusterUuid,
          namespace,
          fresh: cached.fresh,
          ageMs,
        });
        if (!cached.fresh) {
          trackWorkloadEvent("workloads.cache_stale_hit", {
            cacheKey,
            workloadType,
            clusterUuid,
            namespace,
            ageMs,
          });
        }
      } else {
        this.state.cache = {
          state: "miss",
          cachedAt: null,
          ageMs: null,
        };
        trackWorkloadEvent("workloads.cold_start", {
          cacheKey,
          workloadType,
          clusterUuid,
          namespace,
        });
      }
    }

    if (this.abortController) this.abortController.abort();
    const controller = new AbortController();
    this.abortController = controller;

    this.lastFetchParams = { workloadType, namespace, clusterUuid, sortField };

    this.state.isLoading = true;
    this.state.error = null;
    const startedAt = Date.now();

    try {
      const data = await this.requestSharedData(
        cacheKey,
        workloadType,
        clusterUuid,
        namespace,
        sortField,
        mode === "prefetch" ? -4 : workloadType === "overview" ? 5 : 1,
        controller.signal,
      );

      if (!controller.signal.aborted && this.abortController === controller) {
        const mergedData = this.mergePayload(data);
        this.state.data = mergedData;
        this.persistCachedData(cacheKey, mergedData);
        this.state.cache = {
          state: "fresh",
          cachedAt: Date.now(),
          ageMs: 0,
        };
        trackWorkloadEvent("workloads.refresh_duration", {
          cacheKey,
          workloadType,
          clusterUuid,
          namespace,
          durationMs: Date.now() - startedAt,
          ok: true,
        });
        evaluateWorkloadPerfBudgets();
      }
    } catch (error) {
      if (!controller.signal.aborted && this.abortController === controller) {
        this.state.error = error instanceof Error ? error.message : "Unknown error";
        if (!this.state.data) {
          this.state.data = null;
        }
        trackWorkloadEvent("workloads.refresh_duration", {
          cacheKey,
          workloadType,
          clusterUuid,
          namespace,
          durationMs: Date.now() - startedAt,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
        evaluateWorkloadPerfBudgets();
      }
    } finally {
      if (!controller.signal.aborted && this.abortController === controller) {
        this.state.isLoading = false;
      }
    }
  }

  reset(): void {
    if (this.abortController) {
      this.abortController.abort();
    }

    this.state.data = null;
    this.state.isLoading = false;
    this.state.error = null;
    this.state.cache = {
      state: "miss",
      cachedAt: null,
      ageMs: null,
    };
    this.lastFetchParams = null;
  }
}

export function useWorkloadsFetcher() {
  return new WorkloadsFetcher();
}

export async function prefetchWorkloadSnapshot(params: {
  workloadType: WorkloadType;
  namespace: string;
  clusterUuid: string;
  sortField?: string;
}) {
  const fetcher = new WorkloadsFetcher();
  await fetcher.fetchWorkloads(
    params.workloadType,
    params.namespace,
    params.clusterUuid,
    params.sortField,
    false,
    "prefetch",
  );
}

export async function prefetchWorkloadSnapshots(params: {
  workloadTypes: WorkloadType[];
  namespace: string;
  clusterUuid: string;
  sortField?: string;
  maxConcurrent?: number;
}) {
  const uniqueWorkloads = Array.from(
    new Set(params.workloadTypes.filter((workloadType) => !isLocalOnlyWorkload(workloadType))),
  );
  if (uniqueWorkloads.length === 0) return;

  const maxConcurrent = Math.min(6, Math.max(1, params.maxConcurrent ?? 4));
  for (let index = 0; index < uniqueWorkloads.length; index += maxConcurrent) {
    const batch = uniqueWorkloads.slice(index, index + maxConcurrent);
    await Promise.all(
      batch.map(async (workloadType) => {
        try {
          await prefetchWorkloadSnapshot({
            workloadType,
            namespace: params.namespace,
            clusterUuid: params.clusterUuid,
            sortField: params.sortField,
          });
        } catch {
          // Prefetch should never block navigation or foreground actions.
        }
      }),
    );
  }
}

export function invalidateWorkloadsCache(params?: {
  clusterUuid?: string;
  workloadType?: WorkloadType;
  namespace?: string;
  sortField?: string;
}) {
  const clusterFilter = params?.clusterUuid?.trim();
  const workloadFilter = params?.workloadType?.trim();
  const namespaceFilter = params?.namespace?.trim();
  const sortFilter = params?.sortField?.trim();

  const shouldInvalidate = (cacheKey: string) => {
    const [clusterUuid, workloadType, namespace, sortField] = cacheKey.split("::");
    if (clusterFilter && clusterUuid !== clusterFilter) return false;
    if (workloadFilter && workloadType !== workloadFilter) return false;
    if (namespaceFilter && namespace !== namespaceFilter) return false;
    if (sortFilter && sortField !== sortFilter) return false;
    return true;
  };

  let removed = 0;
  for (const cacheKey of [...workloadsCacheMemory.keys()]) {
    if (!shouldInvalidate(cacheKey)) continue;
    workloadsCacheMemory.delete(cacheKey);
    workloadsInFlightRequests.delete(cacheKey);
    removed += 1;
  }

  if (typeof window !== "undefined") {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const storageKey = window.localStorage.key(index);
      if (!storageKey) continue;
      const cacheKey = decodeStorageCacheKey(storageKey);
      if (!cacheKey || !shouldInvalidate(cacheKey)) continue;
      window.localStorage.removeItem(storageKey);
    }
  }

  if (removed > 0) {
    trackWorkloadEvent("workloads.cache_invalidated", {
      clusterUuid: clusterFilter ?? null,
      workloadType: workloadFilter ?? null,
      namespace: namespaceFilter ?? null,
      sortField: sortFilter ?? null,
      removed,
    });
  }

  return removed;
}

export function __resetWorkloadsFetcherCacheForTests() {
  workloadsCacheMemory.clear();
  workloadsInFlightRequests.clear();
  workloadRequestScheduler.clearQueue("workload scheduler reset");
}

export function __getWorkloadsFetcherMemoryCacheStatsForTests() {
  let bytes = 0;
  for (const entry of workloadsCacheMemory.values()) {
    bytes += Math.max(1, entry.bytes);
  }
  return {
    entries: workloadsCacheMemory.size,
    bytes,
  };
}
