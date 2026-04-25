<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { readable, type Readable } from "svelte/store";
  import { goto } from "$app/navigation";
  import { type PageData } from "$entities/cluster";
  import * as Alert from "$shared/ui/alert";
  import type { WorkloadOverview } from "$shared";
  import { kubectlJson } from "$shared/api/kubectl-proxy";
  import { getNodeMetrics } from "$shared/api/tauri";
  import {
    checkCertificatesHealth,
    checkWarningEvents,
    destroyOverviewWarningEventsSync,
    getOverviewWarningEventsSnapshot,
    getOverviewWarningEventsWatcherError,
    getLastHealthCheck,
    updateClusterHealthChecks,
    initOverviewWarningEventsSync,
    isOverviewWarningEventsWatcherActive,
    selectOverviewWarningEvents,
    setInitialOverviewWarningEvents,
    markOverviewSyncError,
    markOverviewSyncLoading,
    markOverviewSyncPartial,
    markOverviewSyncSuccess,
    resetOverviewSyncStatus,
    seedOverviewSyncLastUpdated,
    setOverviewSyncEnabled,
  } from "$features/check-health";
  import { checkNodesHealth } from "$features/check-health/api/check-node-health";
  import type { NodeHealth } from "$features/check-health/api/check-node-health";
  import type {
    CertificateItem,
    ClusterHealthChecks,
    ClusterCheckError,
    KubeletRotationItem,
    WarningEventItem,
  } from "$features/check-health/model/types";
  import ClusterScore from "$widgets/cluster/ui/cluster-score.svelte";
  import ClusterHealthScore from "$widgets/cluster/ui/cluster-health-score.svelte";
  import type { ColumnDef } from "@tanstack/table-core";
  import { renderComponent } from "$shared/ui/data-table";
  import { Button, SortingButton } from "$shared/ui/button";
  import DataTable from "./workloads-table.svelte";
  import OverviewEventsPanel from "./overview-events-panel.svelte";
  import OverviewCertificatesPanel from "./overview-certificates-panel.svelte";
  import { buildMetricsSourcesHref, METRICS_BANNER_CTA } from "./common/metrics-banner-copy";
  import { createSerialRefresh } from "$shared/lib/serial-refresh";
  import {
    dashboardDataProfile,
    getDashboardDataProfileDisplayName,
  } from "$shared/lib/dashboard-data-profile.svelte";
  import {
    evaluateWorkloadPerfBudgets,
    trackWorkloadEvent,
  } from "$features/workloads-management/model/workload-telemetry";
  import {
    averagePercent,
    buildControlPlaneChecks,
    buildMetricsUnavailableMessage,
    buildOverviewResourceInsights,
    buildUsageCards,
    calculateResourcePressure,
    detectManagedProviderInfo,
    parseCpuQuantityToCores,
    parseMemoryQuantityToBytes,
  } from "./model/overview-insights";
  import {
    buildChangeSinceLastCheck,
    buildHealthTimeline,
    buildOverviewSafeActions,
    buildOverviewTopRisks,
    captureOverviewHealthHistoryEntry,
    type OverviewHealthHistoryEntry,
  } from "./model/overview-diagnostics";
  import { fetchOverviewAccessProfile, type OverviewAccessProfile } from "./model/overview-access";
  import { dedupeOverviewRequest } from "./model/overview-request-dedupe";
  import {
    isMetricsServerKnownAvailable,
    recordMetricsServerAvailable,
    recordMetricsServerUnavailable,
  } from "./model/metrics-server-availability";
  import {
    captureOverviewSnapshot as buildOverviewSnapshot,
    createOverviewScopeKey,
    formatCertificate as mapCertificateRow,
    formatEvent as mapEventRow,
    formatRelativeTime,
    formatRotation as mapRotationRow,
    getOverviewSyncSettingsKey as buildOverviewSyncSettingsKey,
    loadOverviewHistory as readOverviewHistory,
    loadOverviewSnapshot as readOverviewSnapshot,
    normalizePercentValue,
    persistOverviewHistory as writeOverviewHistory,
    parseOverviewSnapshot as parseStoredOverviewSnapshot,
    persistOverviewSnapshot as writeOverviewSnapshot,
    shouldKeepStaleSection as shouldKeepOverviewSection,
    sleep,
    withTimeout,
  } from "./model/overview-runtime";
  import SectionRuntimeStatus from "./common/section-runtime-status.svelte";
  import { writeRuntimeDebugLog } from "$shared/lib/runtime-debug";
  import LoadingDots from "$shared/ui/loading-dots.svelte";

  interface OverviewProps {
    data: PageData & {
      overview?: WorkloadOverview;
    };
  }

  const { data }: OverviewProps = $props();

  const path = $derived(`/dashboard/clusters/${encodeURIComponent(data?.slug)}?workload=`);
  type EventRow = {
    uid: string;
    reason: string;
    object: string;
    message: string;
    name: string;
    date: string;
  };

  type CertificateRow = {
    uid: string;
    name: string;
    expiresIn: string;
    expiresOn: string;
    status: string;
  };

  type RotationRow = {
    uid: string;
    node: string;
    rotateClient: string;
    rotateServer: string;
    status: string;
    message: string;
  };
  type OverviewSnapshot = {
    schemaVersion: 1;
    scopeKey: string;
    cachedAt: number;
    eventsHydrated: boolean;
    certificatesHydrated: boolean;
    lastEventsSuccessAt: number;
    lastCertificatesSuccessAt: number;
    eventsRows: EventRow[];
    certificatesRows: CertificateRow[];
    rotationRows: RotationRow[];
    warningItems: WarningEventItem[];
    eventsError: string | null;
    certificatesError: string | null;
    clusterHealth: ClusterHealthChecks | null;
    clusterHealthError: string | null;
    usageMetricsError: string | null;
    cpuAveragePercent: number | null;
    memoryAveragePercent: number | null;
    cpuReservedCores: number | null;
    memoryReservedBytes: number | null;
    coreMetricsUnavailable: boolean | null;
    usageMetricsMode: "actual" | "requested" | null;
    podCapacity: number | null;
    providerIds: string[];
    usageMetricsLastLoadedAt: number;
    accessProfile: OverviewAccessProfile | null;
    accessProfileError: string | null;
  };
  const overviewSnapshotsMemory = new Map<string, OverviewSnapshot>();
  const overviewHistoryMemory = new Map<
    string,
    { schemaVersion: 1; scopeKey: string; entries: OverviewHealthHistoryEntry[] }
  >();

  const eventColumns: ColumnDef<EventRow>[] = [
    {
      accessorKey: "reason",
      header: ({ column }) =>
        renderComponent(SortingButton, {
          label: "Reason",
          onclick: column.getToggleSortingHandler(),
        }),
    },
    { accessorKey: "object", header: "Object" },
    { accessorKey: "message", header: "Message" },
    { accessorKey: "name", header: "Name" },
    {
      accessorKey: "date",
      header: ({ column }) =>
        renderComponent(SortingButton, {
          label: "Date",
          onclick: column.getToggleSortingHandler(),
        }),
    },
  ];

  const certificateColumns: ColumnDef<CertificateRow>[] = [
    {
      accessorKey: "name",
      header: ({ column }) =>
        renderComponent(SortingButton, {
          label: "Name",
          onclick: column.getToggleSortingHandler(),
        }),
    },
    { accessorKey: "expiresIn", header: "Expires In" },
    { accessorKey: "expiresOn", header: "Expires On" },
    { accessorKey: "status", header: "Status" },
  ];

  const rotationColumns: ColumnDef<RotationRow>[] = [
    {
      accessorKey: "node",
      header: ({ column }) =>
        renderComponent(SortingButton, {
          label: "Node",
          onclick: column.getToggleSortingHandler(),
        }),
    },
    { accessorKey: "rotateClient", header: "Client Rotation" },
    { accessorKey: "rotateServer", header: "Server Rotation" },
    { accessorKey: "status", header: "Status" },
    { accessorKey: "message", header: "Message" },
  ];

  let activeTab = $state<"events" | "certificates">("events");
  let eventsRows = $state<EventRow[]>([]);
  let certificatesRows = $state<CertificateRow[]>([]);
  let rotationRows = $state<RotationRow[]>([]);
  let diagnosticsEnabled = $state(false);
  let usageEnabled = $state(false);
  let eventsError = $state<string | null>(null);
  let certificatesError = $state<string | null>(null);
  let eventsLoading = $state(false);
  let certificatesLoading = $state(false);
  let overviewSyncTimeout: ReturnType<typeof setTimeout> | null = null;
  let overviewActivationTimeout: ReturnType<typeof setTimeout> | null = null;
  let eventsWatchdog: ReturnType<typeof setTimeout> | null = null;
  let certificatesWatchdog: ReturnType<typeof setTimeout> | null = null;
  let eventsInFlight = false;
  let certificatesInFlight = false;
  let eventsInFlightTokenId: number | null = null;
  let certificatesInFlightTokenId: number | null = null;
  let usageMetricsError = $state<string | null>(null);
  let overviewSyncSeconds = $state(60);
  let clusterHealth = $state<ClusterHealthChecks | null>(null);
  let clusterHealthError = $state<string | null>(null);
  let warningItems = $state<WarningEventItem[]>([]);
  let cpuAveragePercent = $state<number | null>(null);
  let memoryAveragePercent = $state<number | null>(null);
  let cpuReservedCores = $state<number | null>(null);
  let memoryReservedBytes = $state<number | null>(null);
  let coreMetricsUnavailable = $state<boolean | null>(null);
  let usageMetricsMode = $state<"actual" | "requested" | null>(null);
  let podCapacity = $state<number | null>(null);
  let providerIds = $state<string[]>([]);
  let usageMetricsLastLoadedAt = $state<number>(0);
  let accessProfile = $state<OverviewAccessProfile | null>(null);
  let accessProfileError = $state<string | null>(null);
  let overviewHistory = $state<OverviewHealthHistoryEntry[]>([]);
  let timelineWindow = $state<"1h" | "24h">("1h");
  let safeActionFeedback = $state<string | null>(null);
  let usageLoading = $state(false);
  let accessProfileRefreshing = $state(false);
  let topRisksRefreshing = $state(false);
  let runtimeSectionRefreshing = $state(false);
  let staleTickCounter = $state(0);
  const liveUpdatedLabel = $derived.by(() => {
    void staleTickCounter; // trigger reactivity
    return formatRelativeTime(overviewLastUpdatedAt) ?? "just now";
  });
  let activeOverviewClusterId = $state<string | null>(null);
  let activeOverviewScopeKey = $state<string | null>(null);
  let staleTimer: ReturnType<typeof setInterval> | null = null;
  let overviewMounted = false;
  let showingCachedOverview = $state(false);
  let cachedOverviewAt = $state<number | null>(null);
  let overviewLastUpdatedAt = $state<number | null>(null);
  let eventsHydrated = $state(false);
  let certificatesHydrated = $state(false);
  let lastEventsSuccessAt = $state(0);
  let lastCertificatesSuccessAt = $state(0);
  let overviewWatchedEventsStore: Readable<WarningEventItem[]> = readable([]);
  type RefreshRunToken = {
    id: number;
    cancelled: boolean;
  };
  let refreshTokenSeq = 0;
  let activeRefreshToken: RefreshRunToken = createRefreshToken();
  const EVENTS_TIMEOUT_MS = 15_000;
  const CERTIFICATES_TIMEOUT_MS = 20_000;
  const CERTIFICATES_RETRY_TIMEOUT_MS = 35_000;
  const CERTIFICATES_RETRY_BACKOFF_MS = [750, 1_500];
  const HEALTH_TIMEOUT_MS = 10_000;
  const ACCESS_TIMEOUT_MS = 10_000;
  const ACCESS_REFRESH_MS = 10 * 60 * 1000;
  const USAGE_METRICS_TIMEOUT_MS = 12_000;
  const USAGE_METRICS_REFRESH_MS = 180_000;
  const OVERVIEW_EVENTS_ROWS_MAX = 250;
  const OVERVIEW_CERTIFICATES_ROWS_MAX = 200;
  const OVERVIEW_ROTATION_ROWS_MAX = 200;
  const OVERVIEW_SYNC_SECONDS_DEFAULT = 60;
  const OVERVIEW_SYNC_SECONDS_MIN = 10;
  const OVERVIEW_SYNC_SECONDS_MAX = 300;
  const OVERVIEW_CACHED_ACTIVATION_DELAY_MS = 350;
  const OVERVIEW_SYNC_SETTINGS_PREFIX = "dashboard.overview.sync.settings.v1";
  const OVERVIEW_SNAPSHOT_STORAGE_PREFIX = "dashboard.overview.snapshot.v1";
  const OVERVIEW_HISTORY_STORAGE_PREFIX = "dashboard.overview.history.v1";
  const OVERVIEW_SNAPSHOT_TTL_MS = 15 * 60 * 1000;
  const OVERVIEW_HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
  const OVERVIEW_SNAPSHOT_MAX_ENTRIES = 80;
  const OVERVIEW_HISTORY_MAX_ENTRIES = 96;
  const OVERVIEW_STALE_IF_ERROR_TTL_MS = 30 * 60 * 1000;
  const OVERVIEW_MAIN_THREAD_CHUNK_SIZE = 120;
  const OVERVIEW_VISIBILITY_REFRESH_COOLDOWN_MS = 15_000;
  const OVERVIEW_AUTO_REFRESH_COOLDOWN_MS = 5_000;
  let overviewRefreshStartedAt = $state(0);
  let overviewRefreshSettledAt = $state(0);

  function traceOverviewStage(stage: string, details: Record<string, unknown> = {}) {
    const clusterId = data?.slug ?? "unknown";
    void writeRuntimeDebugLog("overview", stage, {
      clusterId,
      activeTab,
      diagnosticsEnabled,
      usageEnabled,
      showingCachedOverview,
      ...details,
    });
  }

  const resourceInsights = $derived.by(() => {
    const overview = data.overview;
    if (!overview) return [];
    return buildOverviewResourceInsights(overview, clusterHealth, warningItems);
  });
  const usageCards = $derived.by(() =>
    buildUsageCards({
      cpuAveragePercent,
      memoryAveragePercent,
      podCount: data.overview?.pods?.quantity ?? 0,
      podCapacity,
      cpuReservedCores,
      memoryReservedBytes,
      mode: usageMetricsMode ?? "actual",
    }),
  );
  const metricsUnavailableMessage = $derived.by(() =>
    buildMetricsUnavailableMessage(clusterHealth, usageCards, { coreMetricsUnavailable }),
  );
  const managedProviderInfo = $derived.by(() =>
    detectManagedProviderInfo(providerIds, [data?.slug, data?.title, accessProfile?.contextName]),
  );
  const isManagedCluster = $derived(managedProviderInfo.managed);
  const controlPlaneChecks = $derived.by(() =>
    buildControlPlaneChecks({
      checks: clusterHealth,
      isManagedCluster,
      providerLabel: managedProviderInfo.label,
    }),
  );
  const topRisks = $derived.by(() => buildOverviewTopRisks(clusterHealth));
  const currentHealthHistoryEntry = $derived.by(() =>
    captureOverviewHealthHistoryEntry({
      checks: clusterHealth,
      warningItems,
      providerIds,
      capturedAt: overviewLastUpdatedAt ?? Date.now(),
    }),
  );
  const previousHealthHistoryEntry = $derived.by(() => {
    const current = currentHealthHistoryEntry;
    if (!current) return null;
    const candidates = overviewHistory.filter((entry) => entry.capturedAt < current.capturedAt);
    return candidates.length > 0 ? candidates[candidates.length - 1] : null;
  });
  const changeSinceLastCheck = $derived.by(() =>
    buildChangeSinceLastCheck(currentHealthHistoryEntry, previousHealthHistoryEntry),
  );
  const timelineSeries = $derived.by(() =>
    buildHealthTimeline(
      overviewHistory,
      timelineWindow === "1h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000,
    ),
  );
  const safeActions = $derived.by(() =>
    buildOverviewSafeActions({
      checks: clusterHealth,
      warningItems,
    }),
  );
  const overviewPartialMessage = $derived.by(() => {
    if (!certificatesError) return null;
    if (eventsError || clusterHealthError || usageMetricsError || accessProfileError) return null;
    return `Partial data: certificates check is unavailable (${certificatesError}).`;
  });
  function isCertificatesRetryableError(error: unknown): boolean {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return message.includes("timeout") || message.includes("temporar") || message.includes("econn");
  }

  function createRefreshToken(): RefreshRunToken {
    refreshTokenSeq += 1;
    return { id: refreshTokenSeq, cancelled: false };
  }

  function cancelRefreshToken(token: RefreshRunToken | null | undefined) {
    if (!token) return;
    token.cancelled = true;
  }

  function rotateRefreshToken() {
    cancelRefreshToken(activeRefreshToken);
    activeRefreshToken = createRefreshToken();
    return activeRefreshToken;
  }

  function isRefreshTokenActive(token: RefreshRunToken, clusterId: string) {
    return !token.cancelled && token === activeRefreshToken && clusterId === data?.slug;
  }

  function shouldRefreshUsageMetrics(options?: { force?: boolean }) {
    if (options?.force) return true;
    if (usageMetricsLastLoadedAt <= 0) return true;
    return Date.now() - usageMetricsLastLoadedAt >= USAGE_METRICS_REFRESH_MS;
  }

  function shouldRefreshAccessProfile(options?: { force?: boolean }) {
    if (options?.force) return true;
    if (!accessProfile?.updatedAt) return true;
    return Date.now() - accessProfile.updatedAt >= ACCESS_REFRESH_MS;
  }

  function getOverviewScopeKey() {
    return createOverviewScopeKey(data);
  }

  function getOverviewSyncSettingsKey(scopeKey: string) {
    return buildOverviewSyncSettingsKey(OVERVIEW_SYNC_SETTINGS_PREFIX, scopeKey);
  }

  function captureOverviewSnapshot(scopeKey: string): OverviewSnapshot {
    return buildOverviewSnapshot(scopeKey, {
      eventsHydrated,
      certificatesHydrated,
      lastEventsSuccessAt,
      lastCertificatesSuccessAt,
      eventsRows,
      certificatesRows,
      rotationRows,
      warningItems,
      eventsError,
      certificatesError,
      clusterHealth,
      clusterHealthError,
      usageMetricsError,
      cpuAveragePercent,
      memoryAveragePercent,
      cpuReservedCores,
      memoryReservedBytes,
      coreMetricsUnavailable,
      usageMetricsMode,
      podCapacity,
      providerIds,
      usageMetricsLastLoadedAt,
      accessProfile,
      accessProfileError,
    });
  }

  function persistOverviewSnapshot(scopeKey: string) {
    if (!scopeKey) return;
    const snapshot = captureOverviewSnapshot(scopeKey);
    writeOverviewSnapshot(scopeKey, snapshot, overviewSnapshotsMemory, {
      storagePrefix: OVERVIEW_SNAPSHOT_STORAGE_PREFIX,
      ttlMs: OVERVIEW_SNAPSHOT_TTL_MS,
      maxEntries: OVERVIEW_SNAPSHOT_MAX_ENTRIES,
    });
  }

  function persistOverviewHistory(scopeKey: string) {
    if (!scopeKey) return;
    const entry = captureOverviewHealthHistoryEntry({
      checks: clusterHealth,
      warningItems,
      providerIds,
      capturedAt: overviewLastUpdatedAt ?? Date.now(),
    });
    if (!entry) return;
    writeOverviewHistory(scopeKey, entry, overviewHistoryMemory, {
      storagePrefix: OVERVIEW_HISTORY_STORAGE_PREFIX,
      ttlMs: OVERVIEW_HISTORY_TTL_MS,
      maxEntries: OVERVIEW_HISTORY_MAX_ENTRIES,
    });
    overviewHistory = readOverviewHistory(scopeKey, overviewHistoryMemory, {
      storagePrefix: OVERVIEW_HISTORY_STORAGE_PREFIX,
      ttlMs: OVERVIEW_HISTORY_TTL_MS,
      maxEntries: OVERVIEW_HISTORY_MAX_ENTRIES,
    });
  }

  function parseOverviewSnapshot(raw: string | null): OverviewSnapshot | null {
    return parseStoredOverviewSnapshot(raw, OVERVIEW_SNAPSHOT_TTL_MS);
  }

  function loadOverviewSnapshot(scopeKey: string): OverviewSnapshot | null {
    return readOverviewSnapshot(scopeKey, overviewSnapshotsMemory, {
      storagePrefix: OVERVIEW_SNAPSHOT_STORAGE_PREFIX,
      ttlMs: OVERVIEW_SNAPSHOT_TTL_MS,
      maxEntries: OVERVIEW_SNAPSHOT_MAX_ENTRIES,
    });
  }

  function loadOverviewHistory(scopeKey: string): OverviewHealthHistoryEntry[] {
    return readOverviewHistory(scopeKey, overviewHistoryMemory, {
      storagePrefix: OVERVIEW_HISTORY_STORAGE_PREFIX,
      ttlMs: OVERVIEW_HISTORY_TTL_MS,
      maxEntries: OVERVIEW_HISTORY_MAX_ENTRIES,
    });
  }

  function applyOverviewSnapshot(snapshot: OverviewSnapshot) {
    eventsHydrated = snapshot.eventsHydrated;
    certificatesHydrated = snapshot.certificatesHydrated;
    lastEventsSuccessAt = snapshot.lastEventsSuccessAt;
    lastCertificatesSuccessAt = snapshot.lastCertificatesSuccessAt;
    eventsRows = snapshot.eventsRows;
    certificatesRows = snapshot.certificatesRows;
    rotationRows = snapshot.rotationRows;
    warningItems = snapshot.warningItems;
    eventsError = snapshot.eventsError;
    certificatesError = snapshot.certificatesError;
    clusterHealth = snapshot.clusterHealth;
    clusterHealthError = snapshot.clusterHealthError;
    usageMetricsError = snapshot.usageMetricsError;
    cpuAveragePercent = snapshot.cpuAveragePercent;
    memoryAveragePercent = snapshot.memoryAveragePercent;
    cpuReservedCores = snapshot.cpuReservedCores;
    memoryReservedBytes = snapshot.memoryReservedBytes;
    coreMetricsUnavailable = snapshot.coreMetricsUnavailable;
    usageMetricsMode = snapshot.usageMetricsMode ?? null;
    podCapacity = snapshot.podCapacity;
    providerIds = snapshot.providerIds;
    usageMetricsLastLoadedAt = snapshot.usageMetricsLastLoadedAt;
    accessProfile = snapshot.accessProfile;
    accessProfileError = snapshot.accessProfileError;
    cachedOverviewAt = snapshot.cachedAt;
    overviewLastUpdatedAt = snapshot.cachedAt;
  }

  function hydrateOverviewFromSnapshot(scopeKey: string): boolean {
    const snapshot = loadOverviewSnapshot(scopeKey);
    if (!snapshot) return false;
    applyOverviewSnapshot(snapshot);
    overviewHistory = loadOverviewHistory(scopeKey);
    showingCachedOverview = true;
    trackWorkloadEvent("overview.cache_hit", {
      scopeKey,
      ageMs: Math.max(0, Date.now() - snapshot.cachedAt),
    });
    return true;
  }

  function buildTimelinePath(points: Array<{ capturedAt: number; value: number }>) {
    if (points.length === 0) return "";
    if (points.length === 1) return "M 0 28 L 100 28";
    return points
      .map((point, index) => {
        const x = (index / Math.max(1, points.length - 1)) * 100;
        const y = 28 - point.value * 8;
        return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
  }

  async function copyToClipboard(text: string, successMessage: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(text);
    safeActionFeedback = successMessage;
    setTimeout(() => {
      if (safeActionFeedback === successMessage) safeActionFeedback = null;
    }, 2_000);
  }

  async function handleSafeAction(action: { mode: string; target: string }) {
    if (action.mode === "goto") {
      goto(`${path}${action.target}`);
      return;
    }
    if (action.mode === "tab") {
      activeTab = action.target === "certificates" ? "certificates" : "events";
      enableDiagnostics();
      return;
    }
    await copyToClipboard(action.target, "Command copied");
  }

  function formatEvent(item: WarningEventItem): EventRow {
    return mapEventRow(item);
  }

  function formatCertificate(item: CertificateItem): CertificateRow {
    return mapCertificateRow(item);
  }

  function formatRotation(item: KubeletRotationItem): RotationRow {
    return mapRotationRow(item);
  }

  function shouldKeepStaleSection(lastSuccessAt: number, rowsCount: number) {
    return shouldKeepOverviewSection(lastSuccessAt, rowsCount, OVERVIEW_STALE_IF_ERROR_TTL_MS);
  }

  function parsePodCapacity(items: unknown[]): number | null {
    let capacity = 0;
    let hasAny = false;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const node = item as {
        status?: { allocatable?: { pods?: string } };
        spec?: { providerID?: string };
      };
      const podsRaw = node.status?.allocatable?.pods;
      if (podsRaw) {
        const parsed = Number.parseInt(podsRaw, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          capacity += parsed;
          hasAny = true;
        }
      }
    }
    return hasAny ? capacity : null;
  }

  function parseCpuReservedCores(items: unknown[]): number | null {
    let total = 0;
    let hasAny = false;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const cpuRaw = (item as { status?: { allocatable?: { cpu?: string } } }).status?.allocatable
        ?.cpu;
      const parsed = parseCpuQuantityToCores(cpuRaw ?? null);
      if (parsed !== null && parsed > 0) {
        total += parsed;
        hasAny = true;
      }
    }
    return hasAny ? total : null;
  }

  function parseMemoryReservedBytes(items: unknown[]): number | null {
    let total = 0;
    let hasAny = false;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const memoryRaw = (item as { status?: { allocatable?: { memory?: string } } }).status
        ?.allocatable?.memory;
      const parsed = parseMemoryQuantityToBytes(memoryRaw ?? null);
      if (parsed !== null && parsed > 0) {
        total += parsed;
        hasAny = true;
      }
    }
    return hasAny ? total : null;
  }

  function parseProviderIds(items: unknown[]): string[] {
    const values: string[] = [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const providerId = (item as { spec?: { providerID?: string } }).spec?.providerID;
      if (typeof providerId === "string" && providerId.length > 0) {
        values.push(providerId);
      }
    }
    return values;
  }

  function mapUsageRowsFromTopNodes(
    rows: Array<{ name?: string; cpu?: string; memory?: string }>,
  ): NodeHealth[] {
    return rows.map((row, index) => ({
      name: typeof row.name === "string" ? row.name : `node-${index + 1}`,
      cpuUsage: typeof row.cpu === "string" ? row.cpu : "N/A",
      memoryUsage: typeof row.memory === "string" ? row.memory : "N/A",
      diskUsage: "N/A",
    }));
  }

  async function yieldToMainThread() {
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      await new Promise<void>((resolve) => {
        window.requestIdleCallback(() => resolve(), { timeout: 16 });
      });
      return;
    }
    await Promise.resolve();
  }

  async function mapWithMainThreadYield<T, U>(
    items: T[],
    mapper: (item: T) => U,
    chunkSize: number = OVERVIEW_MAIN_THREAD_CHUNK_SIZE,
  ): Promise<U[]> {
    if (items.length <= chunkSize) {
      return items.map(mapper);
    }
    const mapped: U[] = [];
    for (let index = 0; index < items.length; index += chunkSize) {
      const chunk = items.slice(index, index + chunkSize);
      for (const item of chunk) {
        mapped.push(mapper(item));
      }
      await yieldToMainThread();
    }
    return mapped;
  }

  function resetOverviewRefreshState() {
    if (eventsWatchdog) {
      clearTimeout(eventsWatchdog);
      eventsWatchdog = null;
    }
    if (certificatesWatchdog) {
      clearTimeout(certificatesWatchdog);
      certificatesWatchdog = null;
    }
    eventsInFlight = false;
    certificatesInFlight = false;
    eventsInFlightTokenId = null;
    certificatesInFlightTokenId = null;
    eventsLoading = false;
    certificatesLoading = false;
    eventsRows = [];
    certificatesRows = [];
    rotationRows = [];
    eventsHydrated = false;
    certificatesHydrated = false;
    lastEventsSuccessAt = 0;
    lastCertificatesSuccessAt = 0;
    overviewWatchedEventsStore = readable([]);
    warningItems = [];
    eventsError = null;
    certificatesError = null;
    clusterHealth = null;
    clusterHealthError = null;
    usageMetricsError = null;
    accessProfile = null;
    accessProfileError = null;
    cpuAveragePercent = null;
    memoryAveragePercent = null;
    cpuReservedCores = null;
    memoryReservedBytes = null;
    coreMetricsUnavailable = null;
    podCapacity = null;
    providerIds = [];
    usageMetricsLastLoadedAt = 0;
    overviewHistory = [];
    safeActionFeedback = null;
    showingCachedOverview = false;
    cachedOverviewAt = null;
    overviewLastUpdatedAt = null;
    overviewRefreshStartedAt = 0;
    overviewRefreshSettledAt = 0;
  }

  function activateOverviewCluster(clusterId: string, scopeKey: string) {
    traceOverviewStage("activate.start", { scopeKey });
    setOverviewSyncEnabled(clusterId, true);
    loadOverviewSyncSettings(scopeKey);
    overviewHistory = loadOverviewHistory(scopeKey);
    const hydrated = hydrateOverviewFromSnapshot(scopeKey);
    if (hydrated && cachedOverviewAt) {
      seedOverviewSyncLastUpdated(clusterId, cachedOverviewAt);
    }
    traceOverviewStage("activate.snapshot", { scopeKey, hydrated });
    overviewWatchedEventsStore = readable([]);
    if (!hydrated) {
      trackWorkloadEvent("overview.cold_start", {
        clusterId,
        scopeKey,
      });
    }
    const token = rotateRefreshToken();
    stopOverviewActivationTimer();
    overviewActivationTimeout = setTimeout(
      () => {
        overviewActivationTimeout = null;
        traceOverviewStage("activate.timer_fired", { tokenId: token.id, force: true });
        void refreshOverviewSnapshot({ force: true, token }).finally(() => {
          if (isRefreshTokenActive(token, clusterId)) {
            startOverviewSyncTimer(token);
          }
        });
      },
      hydrated ? OVERVIEW_CACHED_ACTIVATION_DELAY_MS : 0,
    );
  }

  function enableDiagnostics() {
    if (diagnosticsEnabled) return;
    diagnosticsEnabled = true;
    const clusterId = data?.slug;
    if (!clusterId) return;
    initOverviewWarningEventsSync(clusterId, warningItems);
    overviewWatchedEventsStore = selectOverviewWarningEvents(clusterId);
    const token = activeRefreshToken;
    if (activeTab === "events") {
      void loadEvents({ force: true }, token);
    }
  }

  function enableUsage(source: "manual-button" | "unknown" = "unknown") {
    if (usageEnabled) return;
    traceOverviewStage("usage.enable", { source });
    usageEnabled = true;
    void loadUsageMetrics({ force: true }, activeRefreshToken);
  }

  function toggleOverviewRuntime() {
    if (diagnosticsEnabled || usageEnabled) {
      diagnosticsEnabled = false;
      usageEnabled = false;
      return;
    }
    enableDiagnostics();
  }

  async function loadUsageMetrics(
    options?: { force?: boolean },
    token: RefreshRunToken = activeRefreshToken,
  ) {
    if (!data?.slug || !usageEnabled) return;
    const clusterId = data.slug;
    if (!shouldRefreshUsageMetrics(options)) {
      return;
    }
    const startedAt = Date.now();
    traceOverviewStage("usage.start", { tokenId: token.id, force: options?.force ?? false });
    usageLoading = true;
    usageMetricsError = null;
    try {
      const dedupeScope = `${clusterId}:${options?.force ? "force" : "normal"}`;
      // Skip the cluster-wide pod listing when a previous probe saw
      // metrics-server working for this cluster - the pod fetch is only
      // used for the requests-based fallback when `kubectl top` is empty.
      // On large clusters the pod listing is the most expensive call here.
      const skipPodsFallback = isMetricsServerKnownAvailable(clusterId);
      const [topNodesResult, nodesResponse, podsResponse] = await dedupeOverviewRequest(
        "overview.usage",
        dedupeScope,
        () =>
          withTimeout(
            Promise.all([
              getNodeMetrics(clusterId).catch(
                () => [] as { name: string; cpu: string; memory: string }[],
              ),
              kubectlJson<{ items?: unknown[] }>("get nodes", { clusterId }).catch(() => null),
              skipPodsFallback
                ? Promise.resolve(null as { items?: unknown[] } | null)
                : kubectlJson<{ items?: unknown[] }>("get pods --all-namespaces", {
                    clusterId,
                  }).catch(() => null),
            ]),
            USAGE_METRICS_TIMEOUT_MS,
            "Usage metrics",
          ),
      );
      if (!isRefreshTokenActive(token, clusterId)) return;
      const nodeItems =
        nodesResponse && typeof nodesResponse === "object" && Array.isArray(nodesResponse.items)
          ? nodesResponse.items
          : [];
      let nodeMetrics = mapUsageRowsFromTopNodes(
        Array.isArray(topNodesResult) ? topNodesResult : [],
      );
      if (nodeMetrics.length > 0) {
        recordMetricsServerAvailable(clusterId);
      } else {
        recordMetricsServerUnavailable(clusterId);
      }
      if (nodeMetrics.length === 0) {
        const fallbackNodes = await withTimeout(
          checkNodesHealth(clusterId, undefined, {
            includeDisk: false,
            allowPrometheusFallback: false,
          }),
          4_000,
          "Usage metrics API fallback",
        );
        if (!isRefreshTokenActive(token, clusterId)) return;
        nodeMetrics = Array.isArray(fallbackNodes) ? fallbackNodes : [];
      }

      // Distinguish a successful empty pod list (valid 0% pressure) from a failed
      // pod fetch (null). Failed fetches must not masquerade as healthy 0% cards.
      const podsFetchSucceeded =
        podsResponse !== null &&
        typeof podsResponse === "object" &&
        Array.isArray(podsResponse.items);

      if (nodeMetrics.length > 0) {
        usageMetricsMode = "actual";
        coreMetricsUnavailable = false;
        cpuAveragePercent = normalizePercentValue(
          averagePercent(nodeMetrics.map((item) => item.cpuUsage)),
        );
        memoryAveragePercent = normalizePercentValue(
          averagePercent(nodeMetrics.map((item) => item.memoryUsage)),
        );
      } else if (nodeItems.length > 0 && podsFetchSucceeded) {
        traceOverviewStage("usage.resource_pressure_fallback", { tokenId: token.id });
        const pressure = calculateResourcePressure(nodeItems, podsResponse.items ?? []);
        usageMetricsMode = "requested";
        coreMetricsUnavailable = false;
        cpuAveragePercent =
          pressure.cpuPercent !== null ? normalizePercentValue(pressure.cpuPercent) : null;
        memoryAveragePercent =
          pressure.memoryPercent !== null ? normalizePercentValue(pressure.memoryPercent) : null;
      } else {
        usageMetricsMode = null;
        coreMetricsUnavailable = true;
        cpuAveragePercent = null;
        memoryAveragePercent = null;
      }

      podCapacity = parsePodCapacity(nodeItems);
      cpuReservedCores = parseCpuReservedCores(nodeItems);
      memoryReservedBytes = parseMemoryReservedBytes(nodeItems);
      providerIds = parseProviderIds(nodeItems);
      traceOverviewStage("usage.success", {
        tokenId: token.id,
        durationMs: Date.now() - startedAt,
        mode: usageMetricsMode,
      });
    } catch (error) {
      if (!isRefreshTokenActive(token, clusterId)) return;
      cpuAveragePercent = null;
      memoryAveragePercent = null;
      cpuReservedCores = null;
      memoryReservedBytes = null;
      coreMetricsUnavailable = null;
      usageMetricsMode = null;
      podCapacity = null;
      providerIds = [];
      usageMetricsError = error instanceof Error ? error.message : "Failed to load usage metrics.";
      traceOverviewStage("usage.error", {
        tokenId: token.id,
        durationMs: Date.now() - startedAt,
        message: usageMetricsError,
      });
    } finally {
      if (isRefreshTokenActive(token, clusterId)) {
        usageMetricsLastLoadedAt = Date.now();
      }
      usageLoading = false;
    }
  }

  async function loadEvents(
    options?: { force?: boolean },
    token: RefreshRunToken = activeRefreshToken,
  ) {
    if (!data?.slug || !diagnosticsEnabled) return;
    const clusterId = data.slug;
    if (eventsInFlight && eventsInFlightTokenId === token.id) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    eventsInFlight = true;
    eventsInFlightTokenId = token.id;
    eventsLoading = true;
    if (eventsWatchdog) clearTimeout(eventsWatchdog);
    eventsWatchdog = setTimeout(() => {
      if (!eventsInFlight || eventsInFlightTokenId !== token.id) return;
      eventsInFlight = false;
      eventsInFlightTokenId = null;
      eventsLoading = false;
      eventsError = `Warning events timeout after ${EVENTS_TIMEOUT_MS}ms`;
      eventsRows = [];
    }, EVENTS_TIMEOUT_MS + 1000);
    try {
      const watcherActive = isOverviewWarningEventsWatcherActive(clusterId);
      const watcherItems = getOverviewWarningEventsSnapshot(clusterId);
      const watcherError = getOverviewWarningEventsWatcherError(clusterId);

      if (watcherActive && (watcherItems.length > 0 || eventsHydrated)) {
        warningItems = watcherItems;
        const mappedRows = await mapWithMainThreadYield(
          watcherItems.slice(0, OVERVIEW_EVENTS_ROWS_MAX),
          formatEvent,
        );
        if (!isRefreshTokenActive(token, clusterId) || eventsInFlightTokenId !== token.id) return;
        eventsRows = mappedRows;
        eventsHydrated = true;
        if (!watcherError) {
          lastEventsSuccessAt = Date.now();
          eventsError = null;
        } else {
          eventsError = watcherError;
        }
      } else {
        const report = await dedupeOverviewRequest(
          "overview.events",
          `${clusterId}:${options?.force ? "force" : "normal"}`,
          () =>
            withTimeout(
              checkWarningEvents(clusterId, options),
              EVENTS_TIMEOUT_MS,
              "Warning events",
            ),
        );
        if (!isRefreshTokenActive(token, clusterId) || eventsInFlightTokenId !== token.id) return;
        warningItems = report.items;
        setInitialOverviewWarningEvents(clusterId, report.items);
        const mappedRows = await mapWithMainThreadYield(
          report.items.slice(0, OVERVIEW_EVENTS_ROWS_MAX),
          formatEvent,
        );
        if (!isRefreshTokenActive(token, clusterId) || eventsInFlightTokenId !== token.id) return;
        eventsRows = mappedRows;
        eventsHydrated = true;
        lastEventsSuccessAt = Date.now();
        eventsError = report.errors ?? watcherError ?? null;
      }
    } catch (error) {
      if (!isRefreshTokenActive(token, clusterId) || eventsInFlightTokenId !== token.id) return;
      eventsError = error instanceof Error ? error.message : "Failed to load events.";
      if (!shouldKeepStaleSection(lastEventsSuccessAt, eventsRows.length)) {
        eventsRows = [];
        warningItems = [];
      }
    } finally {
      if (eventsWatchdog) {
        clearTimeout(eventsWatchdog);
        eventsWatchdog = null;
      }
      if (eventsInFlightTokenId === token.id) {
        eventsLoading = false;
        eventsInFlight = false;
        eventsInFlightTokenId = null;
      }
    }
  }

  async function loadCertificates(
    options?: { force?: boolean },
    token: RefreshRunToken = activeRefreshToken,
  ) {
    if (!data?.slug || !diagnosticsEnabled) return;
    const clusterId = data.slug;
    if (certificatesInFlight && certificatesInFlightTokenId === token.id) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    certificatesInFlight = true;
    certificatesInFlightTokenId = token.id;
    certificatesLoading = true;
    if (certificatesWatchdog) clearTimeout(certificatesWatchdog);
    certificatesWatchdog = setTimeout(
      () => {
        if (!certificatesInFlight || certificatesInFlightTokenId !== token.id) return;
        certificatesInFlight = false;
        certificatesInFlightTokenId = null;
        certificatesLoading = false;
        certificatesError = `Certificates timeout after retries (${CERTIFICATES_TIMEOUT_MS}ms/${CERTIFICATES_RETRY_TIMEOUT_MS}ms).`;
      },
      CERTIFICATES_TIMEOUT_MS + CERTIFICATES_RETRY_TIMEOUT_MS + 3000,
    );
    const forceRefresh = options?.force ?? false;
    const timeouts = [CERTIFICATES_TIMEOUT_MS, CERTIFICATES_RETRY_TIMEOUT_MS];
    let lastError: unknown = null;
    let report: {
      certificates: CertificateItem[];
      kubeletRotation: KubeletRotationItem[];
      errors?: string;
    } | null = null;
    try {
      report = await dedupeOverviewRequest(
        "overview.certificates",
        `${clusterId}:${forceRefresh ? "force" : "normal"}`,
        async () => {
          for (let attempt = 0; attempt < timeouts.length; attempt += 1) {
            try {
              return await withTimeout(
                checkCertificatesHealth(clusterId, {
                  force: forceRefresh || attempt > 0,
                }),
                timeouts[attempt],
                "Certificates",
              );
            } catch (error) {
              lastError = error;
              const canRetry = attempt < timeouts.length - 1 && isCertificatesRetryableError(error);
              if (!canRetry) {
                throw error;
              }
              await sleep(CERTIFICATES_RETRY_BACKOFF_MS[attempt] ?? 0);
            }
          }
          return null as never;
        },
      );
      if (!isRefreshTokenActive(token, clusterId) || certificatesInFlightTokenId !== token.id)
        return;
      if (!report && lastError) throw lastError;
      if (!report) throw new Error("Failed to load certificates.");
      const mappedCertificates = await mapWithMainThreadYield(
        report.certificates.slice(0, OVERVIEW_CERTIFICATES_ROWS_MAX),
        formatCertificate,
      );
      const mappedRotation = await mapWithMainThreadYield(
        report.kubeletRotation.slice(0, OVERVIEW_ROTATION_ROWS_MAX),
        formatRotation,
      );
      if (!isRefreshTokenActive(token, clusterId) || certificatesInFlightTokenId !== token.id)
        return;
      certificatesRows = mappedCertificates;
      rotationRows = mappedRotation;
      certificatesHydrated = true;
      lastCertificatesSuccessAt = Date.now();
      certificatesError = report.errors ?? null;
    } catch (error) {
      if (!isRefreshTokenActive(token, clusterId) || certificatesInFlightTokenId !== token.id)
        return;
      certificatesError = error instanceof Error ? error.message : "Failed to load certificates.";
      if (
        !shouldKeepStaleSection(
          lastCertificatesSuccessAt,
          certificatesRows.length + rotationRows.length,
        )
      ) {
        certificatesRows = [];
        rotationRows = [];
      }
    } finally {
      if (certificatesWatchdog) {
        clearTimeout(certificatesWatchdog);
        certificatesWatchdog = null;
      }
      if (certificatesInFlightTokenId === token.id) {
        certificatesLoading = false;
        certificatesInFlight = false;
        certificatesInFlightTokenId = null;
      }
    }
  }

  async function loadClusterHealthScore(token: RefreshRunToken = activeRefreshToken) {
    if (!data?.slug) return;
    const clusterId = data.slug;
    const startedAt = Date.now();
    traceOverviewStage("health.start", { tokenId: token.id });
    try {
      const latest = await dedupeOverviewRequest("overview.health", clusterId, () =>
        withTimeout(getLastHealthCheck(clusterId), HEALTH_TIMEOUT_MS, "Health score"),
      );
      if (!isRefreshTokenActive(token, clusterId)) return;
      if (latest && (latest as ClusterCheckError).errors) {
        clusterHealth = null;
        clusterHealthError = (latest as ClusterCheckError).errors;
      } else {
        clusterHealth = latest as ClusterHealthChecks | null;
        clusterHealthError = null;
        // Auto-load config + health diagnostics if not present or still deferred
        // so Cluster Score and Control Plane Checks populate
        if (clusterHealth) {
          const needsConfig = !clusterHealth.resourcesHygiene;
          const needsHealth =
            !clusterHealth.apiServerHealth || clusterHealth.apiServerHealth.status === "unknown";
          if (needsConfig || needsHealth) {
            const scopes: Array<"config" | "health"> = [];
            if (needsConfig) scopes.push("config");
            if (needsHealth) scopes.push("health");
            let chain: Promise<unknown> = Promise.resolve();
            for (const scope of scopes) {
              chain = chain.then(() =>
                updateClusterHealthChecks(clusterId, {
                  force: true,
                  diagnostics: true,
                  diagnosticsScope: scope,
                }),
              );
            }
            void chain
              .then(() => getLastHealthCheck(clusterId))
              .then((refreshed) => {
                if (refreshed && !("errors" in refreshed)) {
                  clusterHealth = refreshed as ClusterHealthChecks;
                }
              })
              .catch(() => {
                /* best effort */
              });
          }
        }
      }
      traceOverviewStage("health.success", {
        tokenId: token.id,
        durationMs: Date.now() - startedAt,
        hasError: Boolean(clusterHealthError),
      });
    } catch (error) {
      if (!isRefreshTokenActive(token, clusterId)) return;
      clusterHealth = null;
      clusterHealthError =
        error instanceof Error ? error.message : "Failed to load cluster health.";
      traceOverviewStage("health.error", {
        tokenId: token.id,
        durationMs: Date.now() - startedAt,
        message: clusterHealthError,
      });
    }
  }

  async function loadAccessProfile(
    options?: { force?: boolean },
    token: RefreshRunToken = activeRefreshToken,
  ) {
    if (!data?.slug) return;
    const clusterId = data.slug;
    if (!shouldRefreshAccessProfile(options)) return;
    const startedAt = Date.now();
    traceOverviewStage("access.start", { tokenId: token.id, force: options?.force ?? false });
    try {
      const profile = await dedupeOverviewRequest("overview.access", clusterId, () =>
        withTimeout(fetchOverviewAccessProfile(clusterId), ACCESS_TIMEOUT_MS, "Access profile"),
      );
      if (!isRefreshTokenActive(token, clusterId)) return;
      accessProfile = profile;
      accessProfileError = null;
      traceOverviewStage("access.success", {
        tokenId: token.id,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (!isRefreshTokenActive(token, clusterId)) return;
      accessProfile = null;
      accessProfileError =
        error instanceof Error ? error.message : "Failed to load current access profile.";
      traceOverviewStage("access.error", {
        tokenId: token.id,
        durationMs: Date.now() - startedAt,
        message: accessProfileError,
      });
    }
  }

  function normalizeOverviewSyncSeconds(value: number) {
    if (!Number.isFinite(value)) return OVERVIEW_SYNC_SECONDS_DEFAULT;
    return Math.max(
      OVERVIEW_SYNC_SECONDS_MIN,
      Math.min(OVERVIEW_SYNC_SECONDS_MAX, Math.round(value)),
    );
  }

  function loadOverviewSyncSettings(scopeKey: string) {
    if (!scopeKey || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(getOverviewSyncSettingsKey(scopeKey));
      if (!raw) return;
      const parsed = JSON.parse(raw) as { refreshSeconds?: number };
      overviewSyncSeconds = normalizeOverviewSyncSeconds(
        parsed.refreshSeconds ?? OVERVIEW_SYNC_SECONDS_DEFAULT,
      );
    } catch {
      overviewSyncSeconds = OVERVIEW_SYNC_SECONDS_DEFAULT;
    }
  }

  function persistOverviewSyncSettings() {
    const scopeKey = getOverviewScopeKey();
    if (!scopeKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        getOverviewSyncSettingsKey(scopeKey),
        JSON.stringify({ refreshSeconds: normalizeOverviewSyncSeconds(overviewSyncSeconds) }),
      );
    } catch {
      // ignore storage errors
    }
  }

  function stopOverviewSyncTimer() {
    if (!overviewSyncTimeout) return;
    clearTimeout(overviewSyncTimeout);
    overviewSyncTimeout = null;
  }

  function stopOverviewActivationTimer() {
    if (!overviewActivationTimeout) return;
    clearTimeout(overviewActivationTimeout);
    overviewActivationTimeout = null;
  }

  function scheduleNextOverviewSync(token: RefreshRunToken, clusterId: string) {
    if (!isRefreshTokenActive(token, clusterId)) return;
    overviewSyncTimeout = setTimeout(
      async () => {
        overviewSyncTimeout = null;
        await refreshOverviewSnapshot({ token });
        scheduleNextOverviewSync(token, clusterId);
      },
      normalizeOverviewSyncSeconds(overviewSyncSeconds) * 1000,
    );
  }

  function startOverviewSyncTimer(token: RefreshRunToken = activeRefreshToken) {
    stopOverviewSyncTimer();
    if (!data?.slug) return;
    scheduleNextOverviewSync(token, data.slug);
  }

  const overviewSerialRefresh = createSerialRefresh(
    async (options?: { force?: boolean; token?: RefreshRunToken }) => {
      if (!data?.slug) return;
      const clusterId = data.slug;
      const scopeKey = getOverviewScopeKey();
      const token = options?.token ?? activeRefreshToken;
      if (!isRefreshTokenActive(token, clusterId)) return;
      traceOverviewStage("refresh.start", {
        tokenId: token.id,
        force: options?.force ?? false,
        scopeKey,
      });
      markOverviewSyncLoading(clusterId);
      const refreshStartedAt = Date.now();
      const runRefreshTask = async (name: string, task: () => Promise<void>) => {
        const startedAt = Date.now();
        traceOverviewStage("refresh.section_start", { tokenId: token.id, section: name });
        await task();
        if (!isRefreshTokenActive(token, clusterId)) return;
        persistOverviewSnapshot(scopeKey);
        traceOverviewStage("refresh.section_end", {
          tokenId: token.id,
          section: name,
          durationMs: Date.now() - startedAt,
        });
        trackWorkloadEvent("overview.refresh.section_duration", {
          clusterId,
          scopeKey,
          section: name,
          durationMs: Date.now() - startedAt,
        });
      };
      await runRefreshTask("health", () => loadClusterHealthScore(token));
      if (!isRefreshTokenActive(token, clusterId)) return;
      await Promise.resolve();

      await runRefreshTask("access", () => loadAccessProfile(options, token));
      if (!isRefreshTokenActive(token, clusterId)) return;
      await Promise.resolve();

      if (activeTab === "events") {
        await runRefreshTask("events", () => loadEvents(options, token));
      }
      if (!isRefreshTokenActive(token, clusterId)) return;
      const summaryError =
        clusterHealthError || accessProfileError || (activeTab === "events" ? eventsError : null);
      persistOverviewSnapshot(scopeKey);
      showingCachedOverview = false;
      cachedOverviewAt = null;
      trackWorkloadEvent("overview.refresh.duration", {
        clusterId,
        scopeKey,
        durationMs: Date.now() - refreshStartedAt,
        hasError: Boolean(summaryError),
        partial: Boolean(certificatesError),
      });
      evaluateWorkloadPerfBudgets();
      if (!summaryError) {
        overviewLastUpdatedAt = Date.now();
        persistOverviewHistory(scopeKey);
      }
      if (summaryError) {
        traceOverviewStage("refresh.error", {
          tokenId: token.id,
          durationMs: Date.now() - refreshStartedAt,
          message: summaryError,
        });
        markOverviewSyncError(clusterId, summaryError);
        return;
      }
      if (activeTab === "certificates" && certificatesError) {
        traceOverviewStage("refresh.partial", {
          tokenId: token.id,
          durationMs: Date.now() - refreshStartedAt,
          message: certificatesError,
        });
        markOverviewSyncPartial(clusterId, `Certificates: ${certificatesError}`);
        return;
      }
      traceOverviewStage("refresh.success", {
        tokenId: token.id,
        durationMs: Date.now() - refreshStartedAt,
      });
      markOverviewSyncSuccess(clusterId);
    },
  );

  async function refreshOverviewSnapshot(options?: { force?: boolean; token?: RefreshRunToken }) {
    const clusterId = data?.slug;
    const token = options?.token ?? activeRefreshToken;
    if (!clusterId || !isRefreshTokenActive(token, clusterId)) return;
    const now = Date.now();
    const recentAutoRefreshAt = Math.max(overviewRefreshStartedAt, overviewRefreshSettledAt);
    if (
      !options?.force &&
      recentAutoRefreshAt > 0 &&
      now - recentAutoRefreshAt < OVERVIEW_AUTO_REFRESH_COOLDOWN_MS
    ) {
      traceOverviewStage("refresh.skip_recent", {
        tokenId: token.id,
        force: false,
        cooldownMs: OVERVIEW_AUTO_REFRESH_COOLDOWN_MS,
      });
      return;
    }
    overviewRefreshStartedAt = now;
    await overviewSerialRefresh.trigger(options);
    if (isRefreshTokenActive(token, clusterId)) {
      overviewRefreshSettledAt = Date.now();
    }
  }

  async function refreshOverviewRuntimeSection() {
    if (runtimeSectionRefreshing) return;
    runtimeSectionRefreshing = true;
    try {
      await refreshOverviewSnapshot({ force: true, token: activeRefreshToken });
    } finally {
      runtimeSectionRefreshing = false;
    }
  }

  async function refreshTopRisksNow() {
    if (!data?.slug || topRisksRefreshing) return;
    const clusterId = data.slug;
    const scopeKey = getOverviewScopeKey();
    const token = activeRefreshToken;
    topRisksRefreshing = true;
    markOverviewSyncLoading(clusterId);
    try {
      await loadClusterHealthScore(token);
      if (!isRefreshTokenActive(token, clusterId)) return;
      persistOverviewSnapshot(scopeKey);
      showingCachedOverview = false;
      cachedOverviewAt = null;
      if (clusterHealthError) {
        markOverviewSyncError(clusterId, clusterHealthError);
        return;
      }
      overviewLastUpdatedAt = Date.now();
      persistOverviewHistory(scopeKey);
      markOverviewSyncSuccess(clusterId);
    } finally {
      if (isRefreshTokenActive(token, clusterId)) {
        topRisksRefreshing = false;
      }
    }
  }

  async function refreshAccessProfileNow() {
    if (!data?.slug) return;
    const clusterId = data.slug;
    const scopeKey = getOverviewScopeKey();
    const token = activeRefreshToken;
    accessProfileRefreshing = true;
    markOverviewSyncLoading(clusterId);
    try {
      await loadAccessProfile({ force: true }, token);
      if (!isRefreshTokenActive(token, clusterId)) return;
      persistOverviewSnapshot(scopeKey);
      if (accessProfileError) {
        markOverviewSyncError(clusterId, accessProfileError);
        return;
      }
      markOverviewSyncSuccess(clusterId);
    } catch (error) {
      if (!isRefreshTokenActive(token, clusterId)) return;
      const message =
        error instanceof Error ? error.message : "Failed to refresh current access profile.";
      accessProfileError = message;
      markOverviewSyncError(clusterId, message);
    } finally {
      if (isRefreshTokenActive(token, clusterId)) {
        accessProfileRefreshing = false;
      }
    }
  }

  function setOverviewSyncSeconds(value: number) {
    overviewSyncSeconds = normalizeOverviewSyncSeconds(value);
    persistOverviewSyncSettings();
    startOverviewSyncTimer(activeRefreshToken);
    void refreshOverviewSnapshot({ force: true, token: activeRefreshToken });
  }

  function resetOverviewSyncSettings() {
    overviewSyncSeconds = OVERVIEW_SYNC_SECONDS_DEFAULT;
    persistOverviewSyncSettings();
    startOverviewSyncTimer(activeRefreshToken);
    void refreshOverviewSnapshot({ force: true, token: activeRefreshToken });
  }

  onMount(() => {
    overviewMounted = true;
    // Update stale indicator every 10s
    staleTimer = setInterval(() => {
      staleTickCounter += 1;
    }, 10_000);
    if (data?.slug) {
      activeOverviewClusterId = data.slug;
      activeOverviewScopeKey = getOverviewScopeKey();
      activateOverviewCluster(data.slug, activeOverviewScopeKey);
    }

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        const lastRefreshAt = Math.max(
          overviewRefreshSettledAt,
          overviewLastUpdatedAt ?? 0,
          cachedOverviewAt ?? 0,
        );
        const isRecentlyFresh =
          lastRefreshAt > 0 && Date.now() - lastRefreshAt < OVERVIEW_VISIBILITY_REFRESH_COOLDOWN_MS;
        if (!isRecentlyFresh) {
          void refreshOverviewSnapshot({ token: activeRefreshToken });
        } else {
          traceOverviewStage("refresh.skip_visibility_recent", {
            tokenId: activeRefreshToken.id,
            cooldownMs: OVERVIEW_VISIBILITY_REFRESH_COOLDOWN_MS,
          });
        }
        startOverviewSyncTimer(activeRefreshToken);
        return;
      }
      stopOverviewSyncTimer();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  });

  onDestroy(() => {
    overviewMounted = false;
    if (staleTimer) clearInterval(staleTimer);
    cancelRefreshToken(activeRefreshToken);
    activeRefreshToken = createRefreshToken();
    stopOverviewSyncTimer();
    stopOverviewActivationTimer();
    if (activeOverviewClusterId) {
      destroyOverviewWarningEventsSync(activeOverviewClusterId);
    }
    resetOverviewRefreshState();
    if (activeOverviewClusterId) {
      setOverviewSyncEnabled(activeOverviewClusterId, false);
      resetOverviewSyncStatus(activeOverviewClusterId);
    }
  });

  $effect(() => {
    if (!overviewMounted || !data?.slug || !diagnosticsEnabled) return;
    const token = activeRefreshToken;
    if (activeTab === "events" && !eventsHydrated) {
      void loadEvents({ force: true }, token);
    }
  });

  $effect(() => {
    if (!overviewMounted || !diagnosticsEnabled || activeTab !== "events") return;
    const watched = $overviewWatchedEventsStore;
    if (watched.length === 0 && !eventsHydrated) return;
    warningItems = watched;
    void mapWithMainThreadYield(watched.slice(0, OVERVIEW_EVENTS_ROWS_MAX), formatEvent).then(
      (rows) => {
        if (!overviewMounted || activeTab !== "events") return;
        eventsRows = rows;
        eventsHydrated = true;
        lastEventsSuccessAt = Date.now();
      },
    );
  });

  $effect(() => {
    if (!overviewMounted) return;
    const clusterId = data?.slug ?? null;
    const scopeKey = clusterId ? getOverviewScopeKey() : null;
    if (clusterId === activeOverviewClusterId && scopeKey === activeOverviewScopeKey) return;

    const previousClusterId = activeOverviewClusterId;
    const previousScopeKey = activeOverviewScopeKey;
    activeOverviewClusterId = clusterId;
    activeOverviewScopeKey = scopeKey;
    cancelRefreshToken(activeRefreshToken);
    activeRefreshToken = createRefreshToken();
    stopOverviewSyncTimer();
    stopOverviewActivationTimer();
    diagnosticsEnabled = false;
    usageEnabled = false;
    resetOverviewRefreshState();

    if (previousClusterId && previousClusterId !== clusterId) {
      destroyOverviewWarningEventsSync(previousClusterId);
      setOverviewSyncEnabled(previousClusterId, false);
      resetOverviewSyncStatus(previousClusterId);
    }

    if (previousScopeKey && previousScopeKey !== scopeKey) {
      showingCachedOverview = false;
      cachedOverviewAt = null;
    }

    if (!clusterId || !scopeKey) {
      return;
    }

    overviewSyncSeconds = OVERVIEW_SYNC_SECONDS_DEFAULT;
    activateOverviewCluster(clusterId, scopeKey);
  });
  const overviewRuntimeProfileLabel = $derived(
    `${getDashboardDataProfileDisplayName($dashboardDataProfile)} profile`,
  );
  const overviewRuntimeSourceState = $derived.by(() => {
    if (!diagnosticsEnabled && !usageEnabled) return "paused";
    if (showingCachedOverview) return "cached";
    if (clusterHealthError || eventsError || certificatesError || usageMetricsError) return "stale";
    if (eventsLoading || certificatesLoading) return "live";
    if (overviewLastUpdatedAt) return "live";
    return "idle";
  });
  const overviewRuntimeLastUpdatedLabel = $derived.by(() => {
    if (!diagnosticsEnabled && !usageEnabled) {
      return null;
    }
    if (showingCachedOverview && cachedOverviewAt) {
      return `cached ${formatRelativeTime(cachedOverviewAt) ?? "just now"}`;
    }
    if (overviewLastUpdatedAt) {
      return `updated ${formatRelativeTime(overviewLastUpdatedAt) ?? "just now"}`;
    }
    return null;
  });
  const overviewRuntimeDetail = $derived.by(() => {
    if (!diagnosticsEnabled && !usageEnabled) {
      return "Heavy diagnostics stay paused until you opt in.";
    }
    if (showingCachedOverview) {
      return "Cached overview hydrated first while live checks continue in the background.";
    }
    if (
      clusterHealthError ||
      eventsError ||
      certificatesError ||
      usageMetricsError ||
      accessProfileError
    ) {
      return "One or more overview checks degraded; partial data remains visible.";
    }
    return "Overview diagnostics and control-plane checks are current.";
  });
  const overviewRuntimeReason = $derived.by(() => {
    return (
      overviewPartialMessage ||
      clusterHealthError ||
      accessProfileError ||
      usageMetricsError ||
      eventsError ||
      certificatesError ||
      `Sync every ${overviewSyncSeconds}s. Events and certificates refresh independently.`
    );
  });
</script>

{#if data.overview || showingCachedOverview}
  <div class="mb-3">
    <SectionRuntimeStatus
      sectionLabel="Overview Runtime Status"
      profileLabel={overviewRuntimeProfileLabel}
      sourceState={overviewRuntimeSourceState}
      mode={diagnosticsEnabled || usageEnabled ? "poll" : "manual"}
      budgetSummary={`sync ${overviewSyncSeconds}s`}
      lastUpdatedLabel={overviewRuntimeLastUpdatedLabel}
      detail={overviewRuntimeDetail}
      secondaryActionLabel="Update"
      secondaryActionAriaLabel="Refresh overview runtime section"
      secondaryActionLoading={runtimeSectionRefreshing}
      onSecondaryAction={() => void refreshOverviewRuntimeSection()}
      reason={overviewRuntimeReason}
      actionLabel={diagnosticsEnabled || usageEnabled ? "Pause section" : "Resume section"}
      actionAriaLabel={diagnosticsEnabled || usageEnabled
        ? "Pause overview runtime section"
        : "Resume overview runtime section"}
      onAction={toggleOverviewRuntime}
    />
  </div>
  <div
    class="mb-3 flex flex-wrap items-center justify-end gap-2 text-xs text-gray-500 dark:text-gray-400"
  >
    {#if showingCachedOverview}
      <span
        class="rounded border border-amber-300/70 bg-amber-50 px-2 py-1 text-[11px] text-amber-800"
      >
        Cached · {formatRelativeTime(cachedOverviewAt) ?? "just now"} · Refreshing<LoadingDots />
      </span>
    {:else if overviewLastUpdatedAt}
      <span
        class="rounded border border-emerald-300/70 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800"
      >
        Live · Updated {liveUpdatedLabel}
      </span>
    {/if}
    <span>Sync sec</span>
    <input
      class="h-8 w-20 rounded border border-input bg-background px-2 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      type="number"
      min={OVERVIEW_SYNC_SECONDS_MIN}
      max={OVERVIEW_SYNC_SECONDS_MAX}
      value={overviewSyncSeconds}
      onchange={(event) => {
        const raw = Number(event.currentTarget.value);
        setOverviewSyncSeconds(raw);
      }}
    />
    <Button variant="outline" size="sm" onclick={resetOverviewSyncSettings}>Reset</Button>
  </div>
  {#if overviewPartialMessage}
    <div
      class="mb-3 rounded-md border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-800"
    >
      {overviewPartialMessage}
    </div>
  {/if}
  <div class="mb-6">
    {#if clusterHealthError}
      <Alert.Root variant="destructive">
        <Alert.Title>Cluster health score unavailable</Alert.Title>
        <Alert.Description>{clusterHealthError}</Alert.Description>
      </Alert.Root>
    {:else}
      <div class="grid items-start gap-4 lg:grid-cols-2">
        <ClusterHealthScore checks={clusterHealth} />
        <ClusterScore checks={clusterHealth} />
      </div>
    {/if}
  </div>
  {#if metricsUnavailableMessage}
    <div
      class="mb-4 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800"
    >
      {metricsUnavailableMessage}
      <a
        href={buildMetricsSourcesHref(data.slug)}
        class="ml-1 font-medium underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-300"
      >
        {METRICS_BANNER_CTA}
      </a>
      .
    </div>
  {/if}

  {#if usageEnabled && usageMetricsMode === "requested" && !(usageLoading && usageMetricsLastLoadedAt <= 0)}
    <div
      class="mb-4 rounded-md border border-sky-300/60 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-700/50 dark:bg-sky-950/30 dark:text-sky-300"
    >
      Showing resource requests vs allocatable capacity. Install metrics-server for actual
      CPU/memory usage.
    </div>
  {/if}

  <div class="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
    {#if usageEnabled && !(usageLoading && usageMetricsLastLoadedAt <= 0)}
      {#each usageCards as card (card.id)}
        <article class="rounded-lg border border-border bg-card p-4 text-card-foreground">
          <div class="flex items-center justify-between gap-2">
            <div class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {card.title}
            </div>
            <span
              class={`rounded px-2 py-0.5 text-[11px] font-medium ${
                card.severity === "critical"
                  ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                  : card.severity === "warning"
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                    : card.severity === "ok"
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {card.percent === null ? "Unknown" : `${Math.round(card.percent)}%`}
            </span>
          </div>
          <div class="mt-2 text-2xl font-semibold">{card.value}</div>
          <div class="mt-1 text-xs text-muted-foreground">Used/Reserved: {card.usedReserved}</div>
          <div class="mt-1 text-xs text-muted-foreground">{card.hint}</div>
          <div class="mt-3 h-2 overflow-hidden rounded bg-muted">
            <div
              class={`h-full ${
                card.severity === "critical"
                  ? "bg-rose-500"
                  : card.severity === "warning"
                    ? "bg-amber-500"
                    : card.severity === "ok"
                      ? "bg-emerald-500"
                      : "bg-slate-400"
              }`}
              style={`width: ${card.percent === null ? 0 : Math.max(2, Math.min(100, card.percent))}%`}
            ></div>
          </div>
        </article>
      {/each}
    {:else}
      <div
        class="live-usage-callout rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-card-foreground lg:col-span-3"
      >
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
              <div class="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                Live usage diagnostics paused
              </div>
            </div>
            <div class="mt-1 text-sm text-emerald-800/80 dark:text-emerald-300/80">
              {usageLoading && usageMetricsLastLoadedAt <= 0
                ? "Loading live CPU, memory and pod-capacity diagnostics."
                : "CPU, memory and pod-capacity metrics load on demand to avoid heavy startup traffic."}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
            disabled={usageLoading}
            onclick={() => enableUsage("manual-button")}
          >
            {usageLoading ? "Loading" : "Load live usage"}
          </Button>
        </div>
      </div>
    {/if}
  </div>

  <details class="mb-6 rounded-lg border border-border bg-card text-card-foreground group">
    <summary class="flex items-center justify-between gap-3 cursor-pointer p-4">
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-semibold">Your Access</h3>
        <span class="text-xs text-muted-foreground">RBAC identity & permissions</span>
      </div>
      {#if accessProfile}
        <div class="text-xs text-muted-foreground">
          Updated {formatRelativeTime(accessProfile.updatedAt) ?? "just now"}
        </div>
      {/if}
    </summary>
    <div class="px-4 pb-4">
      {#if accessProfileError}
        <div
          class="mt-4 rounded border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-800"
        >
          Access profile unavailable: {accessProfileError}
        </div>
      {:else if accessProfile}
        <div class="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr,1.9fr]">
          <div class="rounded border border-border/80 bg-background px-3 py-3">
            <div class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Identity
            </div>
            <div class="mt-2 text-lg font-semibold">{accessProfile.subject}</div>
            <div class="mt-1 text-xs text-muted-foreground">
              Source:
              {accessProfile.subjectSource === "auth_whoami"
                ? "API-authenticated identity"
                : accessProfile.subjectSource === "kubeconfig"
                  ? "kubeconfig context"
                  : "unknown"}
            </div>
            <div class="mt-1 text-xs text-muted-foreground">
              Context: {accessProfile.contextName ?? "unknown"}
            </div>
            <div class="mt-1 text-xs text-muted-foreground">
              Namespace scope: {accessProfile.namespace}
            </div>
          </div>

          <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {#each accessProfile.capabilities as capability (capability.id)}
              <div class="rounded border border-border/80 bg-background px-3 py-3">
                <div class="flex items-center justify-between gap-2">
                  <div class="text-xs font-medium">{capability.title}</div>
                  <span
                    class={`rounded px-2 py-0.5 text-[11px] font-medium ${
                      capability.status === "allowed"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                        : capability.status === "denied"
                          ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                          : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    }`}
                  >
                    {capability.status === "allowed"
                      ? "Allowed"
                      : capability.status === "denied"
                        ? "Denied"
                        : "Unknown"}
                  </span>
                </div>
                <div class="mt-2 text-xs text-muted-foreground">{capability.detail}</div>
              </div>
            {/each}
          </div>
        </div>

        <div class="mt-4 rounded border border-border/80 bg-background px-3 py-3">
          <div class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Impact on diagnostics
          </div>
          {#if accessProfile.diagnosticsImpact.length}
            <ul class="mt-2 space-y-1 text-xs text-muted-foreground">
              {#each accessProfile.diagnosticsImpact as impact (impact)}
                <li>{impact}</li>
              {/each}
            </ul>
          {:else}
            <div class="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
              Current RBAC should allow the main overview diagnostics to run without major access
              gaps.
            </div>
          {/if}
          <div class="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={accessProfileRefreshing}
              onclick={() => {
                void refreshAccessProfileNow();
              }}
            >
              {accessProfileRefreshing ? "Refreshing" : "Re-run access probe"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onclick={() => {
                void copyToClipboard(
                  "kubectl auth can-i list pods --all-namespaces && kubectl auth can-i list nodes && kubectl auth can-i list events --all-namespaces",
                  "Access review command copied",
                );
              }}
            >
              Copy kubectl auth can-i
            </Button>
            <Button
              size="sm"
              variant="outline"
              onclick={() => {
                goto(`${path}accessreviews`);
              }}
            >
              Open Access Review
            </Button>
          </div>
        </div>
      {:else}
        <div
          class="mt-4 rounded border border-border/80 bg-background p-4 text-sm text-muted-foreground"
        >
          Access profile will appear after the current refresh completes.
        </div>
      {/if}
    </div>
  </details>

  <div class="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
    <section class="rounded-lg border border-border bg-card p-4 text-card-foreground">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold">Top Risks</h3>
          <div class="text-xs text-muted-foreground">
            Highest-impact issues to investigate first.
          </div>
        </div>
        <div class="flex items-center gap-2">
          <div class="text-xs text-muted-foreground">
            {#if topRisks.length}
              {topRisks.length} active
            {:else}
              No major risks
            {/if}
          </div>
          {#if showingCachedOverview && cachedOverviewAt}
            <span
              class="rounded border border-amber-300/70 bg-amber-50 px-2 py-1 text-[11px] text-amber-800"
            >
              Stale · {formatRelativeTime(cachedOverviewAt) ?? "just now"}
            </span>
          {/if}
          <Button
            size="sm"
            variant="outline"
            disabled={topRisksRefreshing}
            onclick={() => {
              void refreshTopRisksNow();
            }}
          >
            {topRisksRefreshing ? "Refreshing" : "Refresh Top Risks now"}
          </Button>
        </div>
      </div>
      {#if topRisks.length}
        <div class="mt-4 space-y-3">
          {#each topRisks as risk (risk.id)}
            <div class="rounded border border-border/80 bg-background px-3 py-3">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="text-sm font-medium">{risk.title}</div>
                  <div class="mt-1 text-xs text-muted-foreground">{risk.reason}</div>
                  <div class="mt-1 text-xs text-muted-foreground">{risk.fix}</div>
                  {#if risk.evidence}
                    <div class="mt-1 text-xs text-slate-600">Evidence: {risk.evidence}</div>
                  {/if}
                </div>
                <span
                  class={`rounded px-2 py-0.5 text-[11px] font-medium ${
                    risk.severity === "critical"
                      ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                  }`}
                >
                  {risk.severity === "critical" ? "Critical" : "Warn"}
                </span>
              </div>
              <div class="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onclick={() => {
                    void copyToClipboard(risk.command, "Risk command copied");
                  }}
                >
                  {risk.actionLabel}
                </Button>
                <code class="flex-1 min-w-0 rounded bg-muted px-2 py-1 text-[11px] truncate"
                  >{risk.command}</code
                >
                <Button
                  size="sm"
                  variant="ghost"
                  class="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground shrink-0"
                  onclick={() => {
                    void copyToClipboard(risk.command, "Copied!");
                  }}
                >
                  Copy
                </Button>
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <div
          class="mt-4 rounded border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-400"
        >
          No major risks detected in the latest health snapshot.
        </div>
      {/if}
    </section>

    <section class="rounded-lg border border-border bg-card p-4 text-card-foreground">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold">Change Since Last Check</h3>
          <div class="text-xs text-muted-foreground">
            What shifted between the latest two snapshots.
          </div>
        </div>
        <div class="flex items-center gap-2">
          {#if showingCachedOverview && cachedOverviewAt}
            <span
              class="rounded border border-amber-300/70 bg-amber-50 px-2 py-1 text-[11px] text-amber-800"
            >
              Stale baseline · {formatRelativeTime(cachedOverviewAt) ?? "just now"}
            </span>
          {/if}
          <div class="text-xs text-muted-foreground">
            {previousHealthHistoryEntry ? "Baseline available" : "Need 2 samples"}
          </div>
        </div>
      </div>
      {#if changeSinceLastCheck.length}
        <div class="mt-4 space-y-2">
          {#each changeSinceLastCheck as change (change.id)}
            <div
              class="rounded border px-3 py-2.5 flex items-start gap-3
              {change.severity === 'critical'
                ? 'border-rose-300/60 bg-rose-50/50 dark:bg-rose-950/20 dark:border-rose-800/40'
                : change.severity === 'warning'
                  ? 'border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800/40'
                  : 'border-sky-300/60 bg-sky-50/50 dark:bg-sky-950/20 dark:border-sky-800/40'}"
            >
              <span class="text-base leading-none mt-0.5 shrink-0">
                {change.severity === "critical"
                  ? "🔴"
                  : change.severity === "warning"
                    ? "🟡"
                    : "🔵"}
              </span>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium">{change.title}</div>
                <div class="mt-0.5 text-xs text-muted-foreground">{change.detail}</div>
              </div>
              <span
                class={`rounded px-2 py-0.5 text-[11px] font-medium shrink-0 ${
                  change.severity === "critical"
                    ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                    : change.severity === "warning"
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                      : "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
                }`}
              >
                {change.severity === "critical"
                  ? "Critical"
                  : change.severity === "warning"
                    ? "Changed"
                    : "Info"}
              </span>
            </div>
          {/each}
        </div>
      {:else}
        <div
          class="mt-4 rounded border border-emerald-300/40 bg-emerald-50/30 dark:bg-emerald-950/10 dark:border-emerald-800/30 p-4 text-sm text-muted-foreground flex items-center gap-2"
        >
          <span class="text-emerald-500">✓</span>
          {previousHealthHistoryEntry
            ? "No material change detected since the previous snapshot."
            : "This panel activates after the next successful refresh."}
        </div>
      {/if}
    </section>
  </div>

  <div class="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
    <section class="rounded-lg border border-border bg-card p-4 text-card-foreground">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold">Health Timeline</h3>
          <div class="text-xs text-muted-foreground">Spot degradation vs one-off noise.</div>
        </div>
        <div class="flex items-center gap-2">
          {#if showingCachedOverview && cachedOverviewAt}
            <span
              class="rounded border border-amber-300/70 bg-amber-50 px-2 py-1 text-[11px] text-amber-800"
            >
              History from cache · {formatRelativeTime(cachedOverviewAt) ?? "just now"}
            </span>
          {/if}
          <Button
            size="sm"
            variant={timelineWindow === "1h" ? "default" : "outline"}
            onclick={() => {
              timelineWindow = "1h";
            }}
          >
            1h
          </Button>
          <Button
            size="sm"
            variant={timelineWindow === "24h" ? "default" : "outline"}
            onclick={() => {
              timelineWindow = "24h";
            }}
          >
            24h
          </Button>
        </div>
      </div>
      <div class="mt-4 space-y-3">
        {#each timelineSeries as series (series.id)}
          <div class="rounded border border-border/80 bg-background px-3 py-3">
            <div class="mb-2 flex items-center justify-between">
              <div class="text-sm font-medium">{series.title}</div>
              <div class="text-[11px] text-muted-foreground">{series.points.length} samples</div>
            </div>
            {#if series.points.length > 0}
              <svg viewBox="0 0 100 32" class="h-10 w-full overflow-visible">
                <path
                  d={buildTimelinePath(series.points)}
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  class="text-slate-400"
                />
              </svg>
              <div class="mt-1 text-[11px] text-muted-foreground">0 = healthy, 3 = critical</div>
            {:else}
              <div
                class="flex h-10 items-center justify-center rounded bg-muted/30 text-[11px] text-muted-foreground"
              >
                Collecting data - chart appears after 2+ refresh cycles
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </section>

    <section class="rounded-lg border border-border bg-card p-4 text-card-foreground">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold">Safe Actions</h3>
          <div class="text-xs text-muted-foreground">
            Fast next steps from the current health picture.
          </div>
        </div>
        {#if safeActionFeedback}
          <div class="text-xs text-emerald-700 dark:text-emerald-400">{safeActionFeedback}</div>
        {/if}
      </div>
      <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {#each safeActions as action (action.id)}
          <button
            type="button"
            class="rounded border border-border/80 bg-background px-3 py-3 text-left transition hover:bg-muted/40"
            onclick={() => {
              void handleSafeAction(action);
            }}
          >
            <div class="text-sm font-medium">{action.label}</div>
            <div class="mt-1 text-xs text-muted-foreground">{action.detail}</div>
            <div class="mt-2 text-[11px] text-muted-foreground">
              {action.mode === "copy"
                ? action.target
                : action.mode === "tab"
                  ? `Open ${action.target}`
                  : `Go to ${action.target}`}
            </div>
          </button>
        {/each}
      </div>
    </section>
  </div>

  <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
    {#each resourceInsights as insight (insight.key)}
      <button
        type="button"
        class="rounded-lg border border-border bg-card p-4 text-left text-card-foreground transition hover:bg-muted/40"
        onclick={() => {
          goto(`${path}${insight.route}`);
        }}
        title={insight.kubectlHint}
      >
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {insight.title}
            </div>
            <div class="mt-2 text-3xl font-semibold">{insight.quantity}</div>
          </div>
          <span
            class={`rounded px-2 py-0.5 text-[11px] font-medium ${
              insight.severity === "critical"
                ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                : insight.severity === "warning"
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                  : insight.severity === "ok"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                    : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            {insight.severity === "critical"
              ? "Critical"
              : insight.severity === "warning"
                ? "Warn"
                : insight.severity === "ok"
                  ? "OK"
                  : insight.severity === "not_applicable"
                    ? "N/A"
                    : "Unknown"}
          </span>
        </div>
        <div class="mt-2 truncate text-xs text-muted-foreground">{insight.reason}</div>
      </button>
    {/each}
  </div>

  <div class="mt-6 rounded-lg border border-border bg-card p-4 text-card-foreground">
    <div class="mb-3 flex items-center justify-between gap-3">
      <h3 class="text-sm font-semibold">Control Plane Checks</h3>
      <div class="text-xs text-muted-foreground">
        {isManagedCluster
          ? `${managedProviderInfo.label} - managed control plane`
          : "Self-managed control plane"}
      </div>
    </div>
    <div class="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
      {#each controlPlaneChecks as check (check.id)}
        <div class="rounded border border-border/80 bg-background px-3 py-2">
          <div class="flex items-center justify-between gap-2">
            <div class="text-xs font-medium">{check.title}</div>
            <span
              class={`rounded px-2 py-0.5 text-[11px] font-medium ${
                check.severity === "critical"
                  ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                  : check.severity === "warning"
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                    : check.severity === "ok"
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {check.severity === "critical"
                ? "Critical"
                : check.severity === "warning"
                  ? "Warn"
                  : check.severity === "ok"
                    ? "OK"
                    : check.severity === "not_applicable"
                      ? "N/A"
                      : check.severity === "unavailable"
                        ? "Unavailable"
                        : "Unknown"}
            </span>
          </div>
          <div class="mt-1 text-xs text-muted-foreground">{check.detail}</div>
        </div>
      {/each}
    </div>
  </div>

  <div class="mt-6 rounded-lg border border-border bg-card text-card-foreground">
    <div
      class="flex flex-col gap-3 border-b border-border px-4 py-3 md:flex-row md:items-center md:justify-between"
    >
      <div class="flex gap-6 text-sm font-medium">
        <button
          class={`pb-1 ${
            activeTab === "events"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground"
          }`}
          title="Live warning events from the cluster (most recent first)."
          onclick={() => {
            activeTab = "events";
            enableDiagnostics();
          }}
        >
          Events
        </button>
        <button
          class={`pb-1 ${
            activeTab === "certificates"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground"
          }`}
          title="Certificate expiry overview with days remaining."
          onclick={() => {
            activeTab = "certificates";
            enableDiagnostics();
          }}
        >
          Certificates
        </button>
      </div>
      <button
        class="text-sm text-primary disabled:cursor-not-allowed disabled:text-muted-foreground"
        disabled={activeTab === "events" ? eventsLoading : certificatesLoading}
        onclick={() => {
          enableDiagnostics();
          if (activeTab === "events") {
            void loadEvents({ force: true });
          } else {
            void loadCertificates({ force: true });
          }
        }}
      >
        {activeTab === "events"
          ? eventsLoading
            ? "Refreshing"
            : "Refresh"
          : certificatesLoading
            ? "Refreshing"
            : "Refresh"}
      </button>
    </div>
    <div class="p-4">
      {#if activeTab === "events"}
        {#if diagnosticsEnabled || eventsHydrated}
          <OverviewEventsPanel
            rows={eventsRows}
            loading={eventsLoading}
            error={eventsError}
            columns={eventColumns}
          />
        {:else}
          <div
            class="rounded-md border border-border/70 bg-muted/30 px-3 py-4 text-sm text-muted-foreground"
          >
            Live diagnostics are paused to keep Overview responsive. Open the tab again or use
            Refresh to load warning events.
          </div>
        {/if}
      {:else if diagnosticsEnabled || certificatesHydrated}
        <OverviewCertificatesPanel
          {certificatesRows}
          {rotationRows}
          loading={certificatesLoading}
          error={certificatesError}
          {certificateColumns}
          {rotationColumns}
        />
      {:else}
        <div
          class="rounded-md border border-border/70 bg-muted/30 px-3 py-4 text-sm text-muted-foreground"
        >
          Certificate diagnostics are loaded on demand to avoid heavy cluster refresh on page open.
        </div>
      {/if}
    </div>
  </div>
{:else}
  <Alert.Root variant="destructive">
    <Alert.Title>Error</Alert.Title>
    <Alert.Description>No data provided</Alert.Description>
  </Alert.Root>
{/if}
