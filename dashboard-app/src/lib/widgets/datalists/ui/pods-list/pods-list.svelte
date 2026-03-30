<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { writable } from "svelte/store";
  import { resolvePageClusterName, type PageData } from "$entities/cluster";
  import type { PodItem } from "$shared/model/clusters";
  import { openPodAttachModal, openPodShellModal } from "$features/shell";
  import { runDebugDescribe } from "$features/resource-debug-runtime";
  import { startPortForward } from "$shared/api/port-forward";
  import { requestPortForwardStartMode } from "$shared/lib/port-forward-start-mode";
  import { popOutPortForwardPreview } from "$shared/lib/port-forward-preview";
  import {
    destroyPodsSync,
    markPodsSyncError,
    markPodsSyncLoading,
    markPodsSyncSuccess,
    podsStore,
    resetPodsSyncStatus,
    selectClusterPodsSyncStatus,
    setInitialPods,
    setPodsSyncEnabled,
  } from "$features/check-health";
  import {
    getSelectedNamespaceList,
    namespaceMatches,
    selectedNamespace,
  } from "$features/namespace-management";
  import { confirmAction } from "$shared/lib/confirm-action";
  import { kubectlRawArgsFront, kubectlRawFront } from "$shared/api/kubectl-proxy";
  import { Button } from "$shared/ui/button";
  import {
    dashboardDataProfile,
    getDashboardDataProfileDisplayName,
  } from "$shared/lib/dashboard-data-profile.svelte";
  import { getBrowserInvokeFallback, isTauriAvailable } from "$shared/lib/tauri-runtime";
  import { fetchNamespacedSnapshotItems } from "../common/namespaced-snapshot";
  import {
    buildMetricsRecommendationText,
    buildMetricsSourcesHref,
    hasCoreMetricsSourcesUnavailableByChecks,
  } from "../common/metrics-banner-copy";
  import InlineNotice from "$shared/ui/inline-notice.svelte";
  import ResourceSummaryStrip from "../common/resource-summary-strip.svelte";
  import SectionRuntimeStatus from "../common/section-runtime-status.svelte";
  import WorkloadSelectionBar from "../common/workload-selection-bar.svelte";
  import DataTable from "./data-table.svelte";
  import PodBulkActions from "./pod-bulk-actions.svelte";
  import PodDetailsSheet from "./pod-details-sheet.svelte";
  import PodMetricsBoundary from "./pod-metrics-boundary.svelte";
  import PodWorkbenchPanel, { type WorkbenchOpenRequest } from "./pod-workbench-panel.svelte";
  import {
    buildPodsSnapshotScopeKey,
    loadPersistedPodsSnapshot,
  } from "../model/pods-snapshot-cache";
  import {
    buildPodDebugCommand,
    buildPodDeleteCommand,
    buildPodDescribeCommand,
    buildPodEvictArgs,
    buildPodEvictFallbackDeleteArgs,
    pruneSelection,
  } from "./pod-actions";
  import { getPodRef, getPodUid } from "./model/pod-row-adapter";
  import { createPodListRows, filterPodListRows } from "./model/pod-list-row";
  import { shouldShowPodsCacheBanner } from "./model/pod-runtime-ui";
  import { runMetricsSourcesCheck, type MetricsSourceCheck } from "$features/metrics-sources";

  interface PodsListProps {
    data: PageData & { pods?: PodItem[] };
  }

  type WatcherSettings = {
    enabled: boolean;
    refreshSeconds: number;
    enrichedTableEnabled: boolean;
  };

  const WATCHER_SETTINGS_PREFIX = "dashboard.pods.rewrite.settings.v1";
  const DEFAULT_WATCHER_SETTINGS: WatcherSettings = {
    enabled: true,
    refreshSeconds: 30,
    enrichedTableEnabled: false,
  };
  const ENABLE_PODS_SAFE_MODE_HOTFIX = true;
  const PODS_SAFE_MODE_MAX_ROWS = 400;
  const BROWSER_SNAPSHOT_REFRESH_TIMEOUT_MS = 2_000;
  const RUNTIME_SNAPSHOT_REFRESH_TIMEOUT_MS = 12_000;

  let { data }: PodsListProps = $props();

  let watcherEnabled = $state(DEFAULT_WATCHER_SETTINGS.enabled);
  let watcherRefreshSeconds = $state(DEFAULT_WATCHER_SETTINGS.refreshSeconds);
  let watcherError = $state<string | null>(null);
  let watcherSettingsLoaded = $state(false);
  let activeClusterId = $state<string | null>(null);
  let query = $state("");
  let enrichedTableEnabled = $state(DEFAULT_WATCHER_SETTINGS.enrichedTableEnabled);
  let selectedPodIds = $state(new Set<string>());
  let deletingPodIds = $state(new Set<string>());
  let evictingPodIds = $state(new Set<string>());
  let podsSyncStatus = $state<{
    enabled: boolean;
    isLoading: boolean;
    lastUpdatedAt: number | null;
    error: string | null;
  }>({
    enabled: false,
    isLoading: false,
    lastUpdatedAt: null,
    error: null,
  });
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let selectedPod = writable<Partial<PodItem> | null>(null);
  let detailsOpen = writable(false);
  let workbenchRequest = $state<WorkbenchOpenRequest>(null);
  let workbenchRequestToken = 0;
  let previewWorkbenchFallback = $state<{ title: string } | null>(null);
  let metricsRefreshToken = $state(0);
  let podsMetricsLoading = $state(false);
  let podsMetricsByKey = $state(
    new Map<string, { cpu: string; memory: string; cpuMillicores: number; memoryBytes: number }>(),
  );
  let podsMetricsError = $state<string | null>(null);
  let metricsSourceChecks = $state<MetricsSourceCheck[] | null>(null);
  let cachedPodsAt = $state<number | null>(null);
  let cachedSnapshotPods = $state<Partial<PodItem>[]>([]);
  let snapshotRefreshState = $state<"idle" | "loading" | "error">("idle");
  let snapshotRefreshError = $state<string | null>(null);
  let snapshotRefreshPromise: Promise<void> | null = null;
  let manualSnapshotBootstrapKey = $state<string | null>(null);
  let browserSnapshotDegradeTimer: ReturnType<typeof setTimeout> | null = null;

  const clusterPods = $derived.by(() => $podsStore[data.slug] ?? []);
  const sourcePods = $derived.by(() =>
    (clusterPods.length > 0 ? clusterPods : cachedSnapshotPods).filter((pod) =>
      namespaceMatches($selectedNamespace, pod.metadata?.namespace),
    ),
  );
  const pods = $derived.by(() => getPodsDisplaySlice(sourcePods));
  const rows = $derived.by(() => createPodListRows(pods));
  const filteredRows = $derived.by(() => filterPodListRows(rows, query));
  const sourcePodByUid = $derived.by(() => {
    const next = new Map<string, Partial<PodItem>>();
    for (const pod of pods) {
      next.set(getPodUid(pod), pod);
    }
    return next;
  });
  const selectedPods = $derived.by(() =>
    [...selectedPodIds]
      .map((id) => sourcePodByUid.get(id))
      .filter((pod): pod is Partial<PodItem> => Boolean(pod)),
  );
  const availableIds = $derived.by(() => filteredRows.map((row) => row.uid).filter(Boolean));
  const areAllSelected = $derived(
    availableIds.length > 0 && availableIds.every((id) => selectedPodIds.has(id)),
  );
  const isSomeSelected = $derived(selectedPodIds.size > 0 && !areAllSelected);
  const namespaceSummary = $derived.by(() => {
    const selected = getSelectedNamespaceList($selectedNamespace);
    if (selected === null) return "all";
    if (selected.length === 0) return "none";
    return selected.join(", ");
  });
  const podsSummarySyncLabel = $derived.by(() => {
    if (podsSyncStatus.error) return "error";
    if (podsSyncStatus.isLoading) return "loading";
    if (podsSyncStatus.lastUpdatedAt) return "updated";
    return "idle";
  });
  const metricsCoverageCount = $derived.by(() =>
    filteredRows.reduce((count, row) => {
      const hasMetrics = podsMetricsByKey.has(
        `${row.namespace || "default"}/${row.name || "unknown"}`,
      );
      return count + (hasMetrics ? 1 : 0);
    }, 0),
  );
  const hasCachedPods = $derived.by(() => sourcePods.length > 0 || filteredRows.length > 0);
  const podsCacheBanner = $derived.by(() => {
    if (!hasCachedPods) return null;
    const cachedAt = cachedPodsAt ?? podsSyncStatus.lastUpdatedAt;
    const ageLabel = formatRelativeCachedAt(cachedAt);
    if (snapshotRefreshState === "error" || podsSyncStatus.error) {
      return `Cached · ${ageLabel} · Refresh failed, showing last snapshot`;
    }
    if (snapshotRefreshState === "loading" || podsSyncStatus.isLoading) {
      return `Cached · ${ageLabel} · Refreshing...`;
    }
    return `Cached · ${ageLabel} · Ready`;
  });
  const showPodsCacheBanner = $derived.by(() =>
    shouldShowPodsCacheBanner({
      hasCachedPods,
      snapshotRefreshState,
      syncError: podsSyncStatus.error,
      syncLoading: podsSyncStatus.isLoading,
    }),
  );
  const podsRuntimeProfileLabel = $derived(
    `${getDashboardDataProfileDisplayName($dashboardDataProfile)} profile`,
  );
  const podsRuntimeSourceState = $derived.by(() => {
    if (!watcherEnabled) return "paused";
    if ((snapshotRefreshState === "error" || podsSyncStatus.error) && hasCachedPods)
      return "cached";
    if (snapshotRefreshState === "error" || podsSyncStatus.error) return "error";
    if (snapshotRefreshState === "loading" && hasCachedPods) return "cached";
    if (podsSyncStatus.lastUpdatedAt) return "live";
    if (hasCachedPods) return "cached";
    return "idle";
  });
  const podsRuntimeLastUpdatedLabel = $derived.by(() => {
    const timestamp = podsSyncStatus.lastUpdatedAt ?? cachedPodsAt;
    if (!timestamp) return null;
    return `updated ${formatRelativeCachedAt(timestamp)}`;
  });
  const podsRuntimeDetail = $derived.by(() => {
    if (!watcherEnabled)
      return "Watcher disabled. Initial snapshot loads once, then background refresh stays paused.";
    if (snapshotRefreshState === "loading" || podsSyncStatus.isLoading) {
      return "Background snapshot refresh in flight.";
    }
    if (snapshotRefreshState === "error" || podsSyncStatus.error) {
      return "Showing last known pod snapshot while refresh is degraded.";
    }
    return "Active pod snapshot refresh is healthy.";
  });
  const podsRuntimeReason = $derived.by(() => {
    if (watcherError)
      return "Pod runtime degraded. Inspect the active error banner for the latest transport detail.";
    if (snapshotRefreshError) {
      return "Pod snapshot runtime degraded. Inspect the active error banner for the latest transport detail.";
    }
    return `Namespace scope: ${namespaceSummary}. Sync every ${watcherRefreshSeconds}s.`;
  });
  const podMetricsSourcesUnavailable = $derived(
    hasCoreMetricsSourcesUnavailableByChecks(
      (metricsSourceChecks ?? []) as Array<{
        id: string;
        status: "available" | "unreachable" | "not_found";
      }>,
    ),
  );
  const podMetricsRecommendation = $derived.by(() => {
    if (!enrichedTableEnabled || !podsMetricsError || !podMetricsSourcesUnavailable) return null;
    return buildMetricsRecommendationText(metricsSourceChecks ?? undefined, "pods");
  });
  const podMetricsSourcesHref = $derived(buildMetricsSourcesHref(data.slug));

  function showActionSuccess(message: string) {
    toast.success(message);
  }

  function showActionError(message: string) {
    toast.error(message);
  }

  function getPodByUid(uid: string) {
    return sourcePodByUid.get(uid) ?? null;
  }

  function clearRefreshTimer() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  }

  function clearBrowserSnapshotDegradeTimer() {
    if (browserSnapshotDegradeTimer) {
      clearTimeout(browserSnapshotDegradeTimer);
      browserSnapshotDegradeTimer = null;
    }
  }

  async function loadMetricsSourceChecks() {
    if (!data?.slug) return;
    try {
      const metricsSources = await runMetricsSourcesCheck(data.slug, { force: false });
      metricsSourceChecks = metricsSources?.checks ?? null;
    } catch {
      metricsSourceChecks = null;
    }
  }

  function isDocumentVisible() {
    if (typeof document === "undefined") return true;
    return document.visibilityState !== "hidden";
  }

  function getWatcherSettingsKey(clusterId: string) {
    return `${WATCHER_SETTINGS_PREFIX}:${clusterId}`;
  }

  $effect(() => {
    if (!data?.slug) return;
    void loadMetricsSourceChecks();
  });

  function formatRelativeCachedAt(timestamp: number | null) {
    if (!timestamp) return "just now";
    const ageMs = Math.max(0, Date.now() - timestamp);
    if (ageMs < 1_000) return "just now";
    const ageSec = Math.floor(ageMs / 1_000);
    if (ageSec < 60) return `${ageSec}s ago`;
    const ageMin = Math.floor(ageSec / 60);
    if (ageMin < 60) return `${ageMin}m ago`;
    const ageHours = Math.floor(ageMin / 60);
    if (ageHours < 24) return `${ageHours}h ago`;
    const ageDays = Math.floor(ageHours / 24);
    return `${ageDays}d ago`;
  }

  function resolveWorkloadCachedAt(clusterId: string, namespaces: string[] | null) {
    if (typeof window === "undefined" || !clusterId) return null;
    const namespaceSegment =
      namespaces === null ? "all" : namespaces.length > 0 ? namespaces.join(",") : "none";
    const prefix = `dashboard.workloads.cache.v1:${encodeURIComponent(`${clusterId}::pods::${namespaceSegment}::`)}`;
    let newest: number | null = null;
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith(prefix)) continue;
      try {
        const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null") as {
          cachedAt?: number;
        } | null;
        if (typeof parsed?.cachedAt !== "number" || !Number.isFinite(parsed.cachedAt)) continue;
        newest = newest === null ? parsed.cachedAt : Math.max(newest, parsed.cachedAt);
      } catch {
        continue;
      }
    }
    return newest;
  }

  function loadPersistedWorkloadPods(clusterId: string, namespaces: string[] | null) {
    if (typeof window === "undefined" || !clusterId) return null;
    const namespaceSegment =
      namespaces === null ? "all" : namespaces.length > 0 ? namespaces.join(",") : "none";
    const prefix = `dashboard.workloads.cache.v1:${encodeURIComponent(`${clusterId}::pods::${namespaceSegment}::`)}`;
    let newest: { cachedAt: number; pods: Partial<PodItem>[] } | null = null;
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith(prefix)) continue;
      try {
        const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null") as {
          cachedAt?: number;
          data?: Partial<PodItem>[];
        } | null;
        if (
          typeof parsed?.cachedAt !== "number" ||
          !Number.isFinite(parsed.cachedAt) ||
          !Array.isArray(parsed.data)
        ) {
          continue;
        }
        if (!newest || parsed.cachedAt > newest.cachedAt) {
          newest = {
            cachedAt: parsed.cachedAt,
            pods: parsed.data,
          };
        }
      } catch {
        continue;
      }
    }
    return newest;
  }

  function hydrateCachedPodsAt() {
    if (!data.slug) {
      cachedPodsAt = null;
      return;
    }
    const namespaces = getSelectedNamespaceList($selectedNamespace);
    const scopeKey = buildPodsSnapshotScopeKey(data.slug, namespaces);
    const snapshot = loadPersistedPodsSnapshot(scopeKey);
    const workloadCachedAt = resolveWorkloadCachedAt(data.slug, namespaces);
    cachedPodsAt = snapshot?.cachedAt ?? workloadCachedAt ?? null;
  }

  function hydratePodsFromPersistedSnapshot() {
    if (!data.slug) return false;
    const namespaces = getSelectedNamespaceList($selectedNamespace);
    const scopeKey = buildPodsSnapshotScopeKey(data.slug, namespaces);
    const snapshot = loadPersistedPodsSnapshot(scopeKey);
    if (snapshot) {
      cachedSnapshotPods = snapshot.pods;
      setInitialPods(data.slug, snapshot.pods);
      cachedPodsAt = snapshot.cachedAt;
      return snapshot.pods.length > 0;
    }

    const workloadSnapshot = loadPersistedWorkloadPods(data.slug, namespaces);
    if (!workloadSnapshot) return false;

    cachedSnapshotPods = workloadSnapshot.pods;
    setInitialPods(data.slug, workloadSnapshot.pods);
    cachedPodsAt = workloadSnapshot.cachedAt;
    return workloadSnapshot.pods.length > 0;
  }

  function clampWatcherRefreshSeconds(value: number) {
    if (!Number.isFinite(value)) return DEFAULT_WATCHER_SETTINGS.refreshSeconds;
    return Math.min(600, Math.max(5, Math.round(value)));
  }

  function getPodsDisplaySlice(sourcePods: Partial<PodItem>[]) {
    if (!ENABLE_PODS_SAFE_MODE_HOTFIX) return sourcePods;
    if (sourcePods.length <= PODS_SAFE_MODE_MAX_ROWS) return sourcePods;
    return sourcePods.slice(0, PODS_SAFE_MODE_MAX_ROWS);
  }

  function hasBrowserInvoke() {
    const invoke = getBrowserInvokeFallback();
    return typeof invoke === "function";
  }

  async function withSnapshotTimeout<T>(request: Promise<T>) {
    const isBrowserOnly =
      typeof window !== "undefined" &&
      window.location.protocol.startsWith("http") &&
      !isTauriAvailable();
    const timeoutMs = isBrowserOnly
      ? BROWSER_SNAPSHOT_REFRESH_TIMEOUT_MS
      : RUNTIME_SNAPSHOT_REFRESH_TIMEOUT_MS;
    return await Promise.race<T>([
      request,
      new Promise<T>((_, reject) => {
        const timer = setTimeout(() => {
          clearTimeout(timer);
          reject(new Error("Pod watcher sync failed."));
        }, timeoutMs);
      }),
    ]);
  }

  function initializeWatcherSettings(clusterId: string) {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(getWatcherSettingsKey(clusterId));
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<WatcherSettings>;
      watcherEnabled = parsed.enabled ?? DEFAULT_WATCHER_SETTINGS.enabled;
      watcherRefreshSeconds = clampWatcherRefreshSeconds(
        parsed.refreshSeconds ?? DEFAULT_WATCHER_SETTINGS.refreshSeconds,
      );
      enrichedTableEnabled =
        parsed.enrichedTableEnabled ?? DEFAULT_WATCHER_SETTINGS.enrichedTableEnabled;
    } catch {
      watcherEnabled = DEFAULT_WATCHER_SETTINGS.enabled;
      watcherRefreshSeconds = DEFAULT_WATCHER_SETTINGS.refreshSeconds;
      enrichedTableEnabled = DEFAULT_WATCHER_SETTINGS.enrichedTableEnabled;
    }
  }

  function persistWatcherSettings(clusterId: string) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      getWatcherSettingsKey(clusterId),
      JSON.stringify({
        enabled: watcherEnabled,
        refreshSeconds: watcherRefreshSeconds,
        enrichedTableEnabled,
      } satisfies WatcherSettings),
    );
  }

  async function loadPodsSnapshot() {
    if (!data.slug) return;
    if (snapshotRefreshPromise) {
      await snapshotRefreshPromise;
      return;
    }
    snapshotRefreshPromise = (async () => {
      markPodsSyncLoading(data.slug);
      watcherError = null;
      snapshotRefreshState = "loading";
      snapshotRefreshError = null;
      hydratePodsFromPersistedSnapshot();

      const isBrowserOnlyPreview =
        typeof window !== "undefined" &&
        window.location.protocol.startsWith("http") &&
        !isTauriAvailable();
      if (isBrowserOnlyPreview && cachedSnapshotPods.length > 0) {
        const message = "Pod watcher sync failed.";
        watcherError = message;
        snapshotRefreshState = "error";
        snapshotRefreshError = message;
        markPodsSyncError(data.slug, message);
        return;
      }

      try {
        const hadCachedSnapshot = cachedSnapshotPods.length > 0;
        const items = await withSnapshotTimeout(
          fetchNamespacedSnapshotItems<Partial<PodItem>>({
            clusterId: data.slug,
            selectedNamespace: $selectedNamespace,
            resource: "pods",
            errorMessage: "Failed to load pods snapshot.",
          }),
        );
        if (items.length === 0 && hadCachedSnapshot && hasBrowserInvoke()) {
          throw new Error("Pod watcher sync failed.");
        }
        cachedSnapshotPods = items;
        setInitialPods(data.slug, items);
        markPodsSyncSuccess(data.slug);
        snapshotRefreshState = "idle";
        metricsRefreshToken += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load pods snapshot.";
        watcherError = message;
        snapshotRefreshState = "error";
        snapshotRefreshError = message;
        markPodsSyncError(data.slug, message);
      } finally {
        snapshotRefreshPromise = null;
      }
    })();
    await snapshotRefreshPromise;
  }

  function scheduleRefresh() {
    clearRefreshTimer();
    if (!watcherEnabled || !isDocumentVisible()) return;
    refreshTimer = setTimeout(async () => {
      refreshTimer = null;
      if (!isDocumentVisible()) return;
      await loadPodsSnapshot();
      scheduleRefresh();
    }, watcherRefreshSeconds * 1000);
  }

  function onToggleWatcher() {
    watcherEnabled = !watcherEnabled;
  }

  function onResetWatcherSettings() {
    watcherEnabled = DEFAULT_WATCHER_SETTINGS.enabled;
    watcherRefreshSeconds = DEFAULT_WATCHER_SETTINGS.refreshSeconds;
    enrichedTableEnabled = DEFAULT_WATCHER_SETTINGS.enrichedTableEnabled;
  }

  function setDeleting(id: string, next: boolean) {
    const updated = new Set(deletingPodIds);
    if (next) {
      updated.add(id);
    } else {
      updated.delete(id);
    }
    deletingPodIds = updated;
  }

  function setEvicting(id: string, next: boolean) {
    const updated = new Set(evictingPodIds);
    if (next) {
      updated.add(id);
    } else {
      updated.delete(id);
    }
    evictingPodIds = updated;
  }

  function toggleSelection(id: string, next: boolean) {
    const updated = new Set(selectedPodIds);
    if (next) {
      updated.add(id);
    } else {
      updated.delete(id);
    }
    selectedPodIds = updated;
  }

  function toggleAllSelection(next: boolean) {
    if (!next) {
      selectedPodIds = new Set();
      return;
    }
    selectedPodIds = new Set(availableIds);
  }

  function openDetails(rowUid: string) {
    const pod = getPodByUid(rowUid);
    if (!pod) return;
    selectedPod.set(pod);
    detailsOpen.set(true);
  }

  function openWorkbench(
    kind: "logs" | "yaml" | "events" | "investigate",
    pod: Partial<PodItem>,
    options?: { logsPrevious?: boolean },
  ) {
    workbenchRequestToken += 1;
    workbenchRequest = {
      token: workbenchRequestToken,
      kind,
      podUid: getPodUid(pod),
      logsPrevious: options?.logsPrevious,
    };
    if (typeof window !== "undefined" && window.location.protocol.startsWith("http")) {
      setPreviewWorkbenchFallback(kind, getPodRef(pod));
    }
  }

  function setPreviewWorkbenchFallback(
    kind: "logs" | "yaml" | "events" | "investigate",
    podRef: string,
  ) {
    if (typeof window === "undefined" || !window.location.protocol.startsWith("http")) return;
    previewWorkbenchFallback = {
      title:
        kind === "yaml"
          ? `Resource YAML: ${podRef}`
          : kind === "events" || kind === "investigate"
            ? `Pod events: ${podRef}`
            : `Pod logs: ${podRef}`,
    };
  }

  async function copyText(value: string | null) {
    if (!value || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(value);
  }

  async function handlePortForward(pod: Partial<PodItem>) {
    const containers = (pod.spec as unknown as Record<string, unknown>)?.containers as
      | Array<{ ports?: Array<{ containerPort: number }> }>
      | undefined;
    const firstPort = containers?.[0]?.ports?.[0]?.containerPort;
    if (!firstPort) {
      toast.error("No container ports defined for this pod.");
      return;
    }
    const mode = requestPortForwardStartMode(firstPort);
    if (!mode) return;
    const name = pod.metadata?.name ?? "unknown";
    const namespace = pod.metadata?.namespace ?? "default";
    const uniqueKey = `pod/${namespace}/${name}:${firstPort}`;
    const result = await startPortForward({
      namespace,
      resource: `pod/${name}`,
      remotePort: firstPort,
      clusterId: data.slug,
      uniqueKey,
    });
    if (result.success) {
      toast.success(`Port-forward started: localhost:${firstPort} -> ${name}:${firstPort}`);
      if (mode === "start-and-open") {
        void popOutPortForwardPreview(`http://localhost:${firstPort}`);
      }
    } else {
      toast.error(result.error ?? "Failed to start port-forward.");
    }
  }

  async function copyDescribeCommand(pod: Partial<PodItem>) {
    await copyText(
      buildPodDescribeCommand({
        name: pod.metadata?.name,
        namespace: pod.metadata?.namespace,
      }),
    );
    showActionSuccess(`Copied kubectl describe for ${getPodRef(pod)}.`);
  }

  async function copyDebugCommand(pod: Partial<PodItem>) {
    await copyText(
      buildPodDebugCommand({
        name: pod.metadata?.name,
        namespace: pod.metadata?.namespace,
        container: pod.spec?.containers?.[0]?.name,
      }),
    );
    showActionSuccess(`Copied kubectl debug for ${getPodRef(pod)}.`);
  }

  function runPodDebugDescribe(pod: Partial<PodItem>) {
    const name = pod.metadata?.name?.trim();
    if (!name || !data.slug) return;

    runDebugDescribe({
      clusterId: data.slug,
      resource: "pod",
      name,
      namespace: pod.metadata?.namespace ?? "default",
    });
    showActionSuccess(`Opened debug describe for ${getPodRef(pod)}.`);
  }

  async function deletePods(podsToDelete: Partial<PodItem>[]) {
    if (!data.slug || podsToDelete.length === 0) return;
    const confirmed = await confirmAction(
      `Delete ${podsToDelete.length} pod(s)?`,
      "Confirm delete",
    );
    if (!confirmed) return;

    for (const pod of podsToDelete) {
      const podId = getPodUid(pod);
      const command = buildPodDeleteCommand({
        name: pod.metadata?.name,
        namespace: pod.metadata?.namespace,
      });
      if (!command) continue;

      setDeleting(podId, true);
      try {
        const response = await kubectlRawFront(command, { clusterId: data.slug });
        if (response.errors) {
          throw new Error(response.errors);
        }
      } catch (error) {
        showActionError(error instanceof Error ? error.message : "Failed to delete pod.");
        return;
      } finally {
        setDeleting(podId, false);
      }
    }

    showActionSuccess(`Deleted ${podsToDelete.length} pod(s).`);
    selectedPodIds = pruneSelection(
      selectedPodIds,
      availableIds.filter((id) => !podsToDelete.some((pod) => getPodUid(pod) === id)),
    );
    void loadPodsSnapshot();
  }

  async function evictPods(podsToEvict: Partial<PodItem>[]) {
    if (!data.slug || podsToEvict.length === 0) return;
    const confirmed = await confirmAction(`Evict ${podsToEvict.length} pod(s)?`, "Confirm evict");
    if (!confirmed) return;

    for (const pod of podsToEvict) {
      const podId = getPodUid(pod);
      const args = buildPodEvictArgs({
        name: pod.metadata?.name,
        namespace: pod.metadata?.namespace,
      });
      if (!args) continue;

      setEvicting(podId, true);
      try {
        const response = await kubectlRawArgsFront(args, { clusterId: data.slug });
        if (response.errors) {
          const fallbackArgs = buildPodEvictFallbackDeleteArgs({
            name: pod.metadata?.name,
            namespace: pod.metadata?.namespace,
          });
          if (!fallbackArgs) {
            throw new Error(response.errors);
          }
          const fallbackResponse = await kubectlRawArgsFront(fallbackArgs, {
            clusterId: data.slug,
          });
          if (fallbackResponse.errors) {
            throw new Error(fallbackResponse.errors);
          }
        }
      } catch (error) {
        showActionError(error instanceof Error ? error.message : "Failed to evict pod.");
        return;
      } finally {
        setEvicting(podId, false);
      }
    }

    showActionSuccess(`Evicted ${podsToEvict.length} pod(s).`);
    selectedPodIds = pruneSelection(
      selectedPodIds,
      availableIds.filter((id) => !podsToEvict.some((pod) => getPodUid(pod) === id)),
    );
    void loadPodsSnapshot();
  }

  onMount(() => {
    if (!data.slug) return;
    activeClusterId = data.slug;
    initializeWatcherSettings(data.slug);
    watcherSettingsLoaded = true;

    const unsubscribe = selectClusterPodsSyncStatus(data.slug).subscribe((value) => {
      podsSyncStatus = value;
    });

    hydratePodsFromPersistedSnapshot();

    const handleVisibilityChange = () => {
      if (!watcherEnabled) return;
      if (isDocumentVisible()) {
        hydrateCachedPodsAt();
        void loadPodsSnapshot();
        scheduleRefresh();
        return;
      }
      clearRefreshTimer();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (watcherEnabled && isDocumentVisible()) {
      void loadPodsSnapshot();
      scheduleRefresh();
    }

    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  });

  $effect(() => {
    if (!data.slug) return;
    if (!Array.isArray(data.pods)) return;
    if (data.pods.length === 0) {
      hydratePodsFromPersistedSnapshot();
      hydrateCachedPodsAt();
      metricsRefreshToken += 1;
      return;
    }
    cachedSnapshotPods = data.pods;
    setInitialPods(data.slug, data.pods);
    hydrateCachedPodsAt();
    metricsRefreshToken += 1;
  });

  $effect(() => {
    if (!data.slug) return;
    const currentNamespace = $selectedNamespace;
    void currentNamespace;
    hydratePodsFromPersistedSnapshot();
    hydrateCachedPodsAt();
  });

  $effect(() => {
    const clusterId = data?.slug ?? null;
    if (activeClusterId && activeClusterId !== clusterId) {
      const previousClusterId = activeClusterId;
      setPodsSyncEnabled(previousClusterId, false);
      destroyPodsSync(previousClusterId);
      resetPodsSyncStatus(previousClusterId);
      clearRefreshTimer();
    }
    activeClusterId = clusterId;
  });

  $effect(() => {
    if (!data.slug || !watcherSettingsLoaded) return;
    persistWatcherSettings(data.slug);
  });

  $effect(() => {
    if (!data.slug || !watcherSettingsLoaded) return;
    setPodsSyncEnabled(data.slug, watcherEnabled);

    if (!watcherEnabled) {
      clearRefreshTimer();
      return;
    }
    if (!isDocumentVisible()) return;

    void loadPodsSnapshot();
    scheduleRefresh();

    return () => {
      clearRefreshTimer();
    };
  });

  $effect(() => {
    if (!data.slug || !watcherSettingsLoaded || watcherEnabled) return;
    if (!isDocumentVisible()) return;
    if (manualSnapshotBootstrapKey === data.slug) return;
    manualSnapshotBootstrapKey = data.slug;
    void loadPodsSnapshot();
  });

  $effect(() => {
    clearBrowserSnapshotDegradeTimer();
    if (typeof window === "undefined") return;
    if (!window.location.protocol.startsWith("http") || isTauriAvailable()) return;
    if (!hasCachedPods) return;
    if (snapshotRefreshState !== "loading") return;

    browserSnapshotDegradeTimer = setTimeout(() => {
      if (snapshotRefreshState !== "loading") return;
      const message = snapshotRefreshError || watcherError || "Pod watcher sync failed.";
      watcherError = message;
      snapshotRefreshError = message;
      snapshotRefreshState = "error";
      if (data.slug) {
        markPodsSyncError(data.slug, message);
      }
    }, BROWSER_SNAPSHOT_REFRESH_TIMEOUT_MS + 250);

    return () => {
      clearBrowserSnapshotDegradeTimer();
    };
  });

  $effect(() => {
    selectedPodIds = pruneSelection(selectedPodIds, availableIds);
  });

  onDestroy(() => {
    clearRefreshTimer();
    clearBrowserSnapshotDegradeTimer();
    if (!activeClusterId) return;
    setPodsSyncEnabled(activeClusterId, false);
    destroyPodsSync(activeClusterId);
    resetPodsSyncStatus(activeClusterId);
  });
</script>

<div class="grid w-full grid-cols-1 gap-4 overflow-visible">
  {#if ENABLE_PODS_SAFE_MODE_HOTFIX && pods.length < sourcePods.length}
    <InlineNotice class="border-amber-300/60 bg-amber-50 text-amber-950" title="Safe mode">
      Rendering first {PODS_SAFE_MODE_MAX_ROWS} of {sourcePods.length} pods while the page stays in safe
      mode.
    </InlineNotice>
  {/if}

  {#if showPodsCacheBanner && podsCacheBanner}
    <InlineNotice class="border-border/60 bg-background text-muted-foreground">
      {podsCacheBanner}
    </InlineNotice>
  {/if}

  <PodWorkbenchPanel
    clusterId={data.slug}
    podsByUid={sourcePodByUid}
    metricsByKey={podsMetricsByKey}
    metricsError={podsMetricsError}
    request={workbenchRequest}
    onMessage={(message) => {
      showActionSuccess(message);
    }}
    onError={(message) => {
      showActionError(message);
    }}
  />
  {#if selectedPods.length > 0}
    <WorkloadSelectionBar count={selectedPods.length}>
      {#snippet children()}
        <PodBulkActions
          canOpenShell={selectedPods.length === 1}
          canAttach={selectedPods.length === 1}
          canEditYaml={selectedPods.length === 1}
          canInvestigate={selectedPods.length === 1}
          canCopyDescribe={selectedPods.length === 1}
          canRunDebugDescribe={selectedPods.length === 1}
          canCopyDebug={selectedPods.length === 1}
          canExportIncident={false}
          canDownloadYaml={false}
          canOpenLogs={selectedPods.length === 1}
          canOpenPreviousLogs={selectedPods.length === 1}
          isYamlBusy={false}
          isExportingIncident={false}
          isDownloadingYaml={false}
          isDeleting={selectedPods.some((pod) => deletingPodIds.has(getPodUid(pod)))}
          isEvicting={selectedPods.some((pod) => evictingPodIds.has(getPodUid(pod)))}
          onShell={() => {
            const pod = selectedPods[0];
            if (!pod) return;
            void openPodShellModal(data.slug, pod);
          }}
          onAttach={() => {
            const pod = selectedPods[0];
            if (!pod) return;
            void openPodAttachModal(data.slug, pod);
          }}
          onEditYaml={() => {
            const pod = selectedPods[0];
            if (!pod) return;
            openWorkbench("yaml", pod);
          }}
          onInvestigate={() => {
            const pod = selectedPods[0];
            if (!pod) return;
            openWorkbench("investigate", pod);
          }}
          onCopyDescribe={() => {
            const pod = selectedPods[0];
            if (!pod) return;
            void copyDescribeCommand(pod);
          }}
          onRunDebugDescribe={() => {
            const pod = selectedPods[0];
            if (!pod) return;
            runPodDebugDescribe(pod);
          }}
          onCopyDebug={() => {
            const pod = selectedPods[0];
            if (!pod) return;
            void copyDebugCommand(pod);
          }}
          onExportIncident={() => {}}
          onDownloadYaml={() => {}}
          onEvict={() => {
            void evictPods(selectedPods);
          }}
          onLogs={() => {
            const pod = selectedPods[0];
            if (!pod) return;
            openWorkbench("logs", pod);
          }}
          onPreviousLogs={() => {
            const pod = selectedPods[0];
            if (!pod) return;
            openWorkbench("logs", pod, { logsPrevious: true });
          }}
          onDelete={() => {
            void deletePods(selectedPods);
          }}
        />
        <Button
          variant="outline"
          size="sm"
          onclick={() => {
            selectedPodIds = new Set<string>();
          }}
        >
          Clear
        </Button>
      {/snippet}
    </WorkloadSelectionBar>
  {/if}

  <ResourceSummaryStrip
    items={[
      { label: "Cluster", value: resolvePageClusterName(data), tone: "foreground" },
      { label: "Namespace", value: namespaceSummary },
      { label: "Pods", value: filteredRows.length },
      { label: "Sync", value: podsSummarySyncLabel },
    ]}
    trailingItem={{
      label: "View",
      value: enrichedTableEnabled ? "Enriched" : "Base",
      valueClass: "text-foreground",
    }}
  />

  <SectionRuntimeStatus
    sectionLabel="Pods Runtime Status"
    profileLabel={podsRuntimeProfileLabel}
    sourceState={podsRuntimeSourceState}
    mode={watcherEnabled ? "poll" : "manual"}
    budgetSummary={`sync ${watcherRefreshSeconds}s`}
    lastUpdatedLabel={podsRuntimeLastUpdatedLabel}
    detail={podsRuntimeDetail}
    secondaryActionLabel="Update"
    secondaryActionAriaLabel="Refresh pods runtime section"
    secondaryActionLoading={snapshotRefreshState === "loading"}
    onSecondaryAction={() => void loadPodsSnapshot()}
    reason={podsRuntimeReason}
    actionLabel={watcherEnabled ? "Pause section" : "Resume section"}
    actionAriaLabel={watcherEnabled ? "Pause pod runtime section" : "Resume pod runtime section"}
    onAction={onToggleWatcher}
  />

  <DataTable
    rows={filteredRows}
    {query}
    onQueryChange={(value) => {
      query = value;
    }}
    {enrichedTableEnabled}
    metricsByKey={podsMetricsByKey}
    {metricsCoverageCount}
    metricsLoading={podsMetricsLoading}
    metricsError={podsMetricsError}
    metricsRecommendation={podMetricsRecommendation}
    metricsSourcesHref={podMetricsSourcesHref}
    onToggleEnrichedTable={() => {
      enrichedTableEnabled = !enrichedTableEnabled;
    }}
    isSelected={(id) => selectedPodIds.has(id)}
    {areAllSelected}
    {isSomeSelected}
    onToggleSelect={(id, next) => {
      toggleSelection(id, next);
    }}
    onToggleAll={(next) => {
      toggleAllSelection(next);
    }}
    onOpenDetails={(row) => {
      openDetails(row.uid);
    }}
    onEvents={(row) => {
      const pod = getPodByUid(row.uid);
      if (pod) openWorkbench("events", pod);
    }}
    onShell={(row) => {
      const pod = getPodByUid(row.uid);
      if (!pod) return;
      void openPodShellModal(data.slug, pod);
    }}
    onAttach={(row) => {
      const pod = getPodByUid(row.uid);
      if (!pod) return;
      void openPodAttachModal(data.slug, pod);
    }}
    onLogs={(row) => {
      setPreviewWorkbenchFallback("logs", `${row.namespace}/${row.name}`);
      const pod = getPodByUid(row.uid);
      if (!pod) return;
      openWorkbench("logs", pod);
    }}
    onPreviousLogs={(row) => {
      setPreviewWorkbenchFallback("logs", `${row.namespace}/${row.name}`);
      const pod = getPodByUid(row.uid);
      if (!pod) return;
      openWorkbench("logs", pod, { logsPrevious: true });
    }}
    onEditYaml={(row) => {
      setPreviewWorkbenchFallback("yaml", `${row.namespace}/${row.name}`);
      const pod = getPodByUid(row.uid);
      if (!pod) return;
      openWorkbench("yaml", pod);
    }}
    onInvestigate={(row) => {
      setPreviewWorkbenchFallback("investigate", `${row.namespace}/${row.name}`);
      const pod = getPodByUid(row.uid);
      if (!pod) return;
      openWorkbench("investigate", pod);
    }}
    onCopyDescribe={(row) => {
      const pod = getPodByUid(row.uid);
      if (!pod) return;
      void copyDescribeCommand(pod);
    }}
    onRunDebugDescribe={(row) => {
      const pod = getPodByUid(row.uid);
      if (!pod) return;
      runPodDebugDescribe(pod);
    }}
    onCopyDebug={(row) => {
      const pod = getPodByUid(row.uid);
      if (!pod) return;
      void copyDebugCommand(pod);
    }}
    onPortForward={(row) => {
      const pod = getPodByUid(row.uid);
      if (!pod) return;
      void handlePortForward(pod);
    }}
    onEvict={(row) => {
      const pod = getPodByUid(row.uid);
      if (!pod) return;
      void evictPods([pod]);
    }}
    onDelete={(row) => {
      const pod = getPodByUid(row.uid);
      if (!pod) return;
      void deletePods([pod]);
    }}
    isDeleting={(id) => deletingPodIds.has(id)}
    isEvicting={(id) => evictingPodIds.has(id)}
    {watcherEnabled}
    {watcherRefreshSeconds}
    {watcherError}
    {onToggleWatcher}
    onWatcherRefreshSecondsChange={(value) => {
      watcherRefreshSeconds = clampWatcherRefreshSeconds(value);
    }}
    {onResetWatcherSettings}
  />

  <PodDetailsSheet
    data={selectedPod}
    isOpen={detailsOpen}
    clusterId={data.slug}
    metricsByKey={new Map(
      [...podsMetricsByKey.entries()].map(([key, value]) => [
        key,
        { cpu: value.cpu, memory: value.memory },
      ]),
    )}
    metricsError={podsMetricsError}
    runtimeProfileLabel={podsRuntimeProfileLabel}
    runtimeSourceState={podsRuntimeSourceState}
    runtimeLastUpdatedLabel={podsRuntimeLastUpdatedLabel}
    runtimeDetail={podsRuntimeDetail}
    runtimeReason={podsRuntimeReason}
    runtimeRequestPath={watcherEnabled
      ? `snapshot refresh every ${watcherRefreshSeconds}s`
      : "manual refresh only"}
    runtimeSyncError={watcherError ?? snapshotRefreshError}
    onShell={(pod) => {
      void openPodShellModal(data.slug, pod);
    }}
    onAttach={(pod) => {
      void openPodAttachModal(data.slug, pod);
    }}
    onLogs={(pod) => {
      openWorkbench("logs", pod);
    }}
    onPreviousLogs={(pod) => {
      openWorkbench("logs", pod, { logsPrevious: true });
    }}
    onEditYaml={(pod) => {
      openWorkbench("yaml", pod);
    }}
    onInvestigate={(pod) => {
      openWorkbench("investigate", pod);
    }}
    onCopyDescribe={(pod) => {
      void copyDescribeCommand(pod);
    }}
    onRunDebugDescribe={(pod) => {
      runPodDebugDescribe(pod);
    }}
    onCopyDebug={(pod) => {
      void copyDebugCommand(pod);
    }}
    onEvents={(pod) => {
      openWorkbench("events", pod);
    }}
    onEvict={(pod) => {
      void evictPods([pod]);
    }}
    onDelete={(pod) => {
      void deletePods([pod]);
    }}
  />

  <PodMetricsBoundary
    clusterId={data.slug}
    pods={sourcePods}
    refreshToken={metricsRefreshToken}
    onMetricsChange={(metrics) => {
      podsMetricsByKey = metrics;
    }}
    onMetricsErrorChange={(message) => {
      podsMetricsError = message;
    }}
    onMetricsLoadingChange={(loading) => {
      podsMetricsLoading = loading;
    }}
  />
</div>
