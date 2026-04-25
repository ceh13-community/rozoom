<script lang="ts">
  import { onMount } from "svelte";
  import { page, navigating } from "$app/state";
  import { writeRuntimeDebugLog } from "$shared/lib/runtime-debug";
  import {
    dashboardDataProfile,
    shouldAutoRunDiagnostics,
  } from "$shared/lib/dashboard-data-profile.svelte";
  import {
    deprecationScanState,
    markScanUnavailable,
    runDeprecationScan,
    startDeprecationScanPolling,
    stopDeprecationScanPolling,
  } from "$features/deprecation-scan";
  import { scheduleSummaryBootstrap } from "./model/summary-bootstrap-queue";
  import LoadingDots from "$shared/ui/loading-dots.svelte";

  interface Props {
    clusterId: string;
    offline?: boolean;
    lazyLoad?: boolean;
  }

  const { clusterId, offline = false, lazyLoad = false }: Props = $props();
  let manuallyActivated = $state(false);

  const scanState = $derived($deprecationScanState[clusterId]);
  const summary = $derived(scanState?.summary ?? null);
  let pageVisible = $state(true);
  const autoDiagnosticsEnabled = $derived(shouldAutoRunDiagnostics($dashboardDataProfile));
  const dashboardRootActive = $derived(page.url.pathname === "/dashboard" && !navigating.to);

  const statusStyles: Record<string, string> = {
    ok: "bg-emerald-500",
    warning: "bg-amber-500",
    critical: "bg-rose-600",
    unavailable: "bg-slate-500",
    needsConfig: "bg-indigo-500",
  };

  const statusEmoji: Record<string, string> = {
    ok: "✅",
    warning: "🟠",
    critical: "❌",
    unavailable: "⚠️",
    needsConfig: "⚙️",
  };

  let bootstrapInFlight = $state<Promise<void> | null>(null);
  let lastVisibleLogKey: string | null = null;
  let pollingActive = false;

  function syncPageVisibility() {
    if (typeof document === "undefined") {
      pageVisible = true;
      return;
    }
    pageVisible = document.visibilityState !== "hidden";
  }

  onMount(() => {
    syncPageVisibility();
    const handleVisibility = () => {
      syncPageVisibility();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  });

  async function ensureSummaryLoaded() {
    if (!clusterId || summary || bootstrapInFlight) return;
    void writeRuntimeDebugLog("runtime", "deprecation_summary_bootstrap_requested", { clusterId });
    bootstrapInFlight = scheduleSummaryBootstrap(clusterId, "deprecation", () =>
      runDeprecationScan(clusterId, { source: "auto" }).then(() => undefined),
    )
      .catch(() => {
        // Polling keeps handling retries; this just fills empty summary state opportunistically.
      })
      .finally(() => {
        bootstrapInFlight = null;
      });
    await bootstrapInFlight;
  }

  $effect(() => {
    if (summary) {
      const visibleLogKey = `${clusterId}:${summary.status}:${summary.message}`;
      if (lastVisibleLogKey !== visibleLogKey) {
        lastVisibleLogKey = visibleLogKey;
        void writeRuntimeDebugLog("runtime", "deprecation_summary_visible", {
          clusterId,
          status: summary.status,
        });
      }
    }
  });

  $effect(() => {
    if (!clusterId) return;
    if (lazyLoad && !manuallyActivated) return;
    if (offline || !autoDiagnosticsEnabled || !dashboardRootActive) return;

    if (!summary) {
      void ensureSummaryLoaded();
    }
  });

  function handleManualLoad() {
    manuallyActivated = true;
    void ensureSummaryLoaded();
  }

  $effect(() => {
    if (!clusterId) return;

    // In lazy mode, don't start polling until manually activated or summary already loaded from cache
    if (lazyLoad && !manuallyActivated && !summary) {
      if (pollingActive) {
        stopDeprecationScanPolling(clusterId);
        pollingActive = false;
      }
      return;
    }

    if (offline) {
      if (pollingActive) {
        void writeRuntimeDebugLog("runtime", "deprecation_summary_poll_stopped", {
          clusterId,
          reason: "offline",
        });
        stopDeprecationScanPolling(clusterId);
        pollingActive = false;
      }
      markScanUnavailable(clusterId, "Scan unavailable: cluster is offline");
      return;
    }

    if (!autoDiagnosticsEnabled) {
      if (pollingActive) {
        void writeRuntimeDebugLog("runtime", "deprecation_summary_poll_stopped", {
          clusterId,
          reason: "auto_diagnostics_disabled",
        });
        stopDeprecationScanPolling(clusterId);
        pollingActive = false;
      }
      return;
    }

    if (!dashboardRootActive) {
      if (pollingActive) {
        void writeRuntimeDebugLog("runtime", "deprecation_summary_poll_stopped", {
          clusterId,
          reason: "dashboard_inactive",
        });
        stopDeprecationScanPolling(clusterId);
        pollingActive = false;
      }
      return;
    }

    if (!pageVisible) {
      if (pollingActive) {
        void writeRuntimeDebugLog("runtime", "deprecation_summary_poll_stopped", {
          clusterId,
          reason: "page_hidden",
        });
        stopDeprecationScanPolling(clusterId);
        pollingActive = false;
      }
      return;
    }

    if (!pollingActive) {
      void writeRuntimeDebugLog("runtime", "deprecation_summary_poll_started", { clusterId });
      startDeprecationScanPolling(clusterId);
      pollingActive = true;
    }

    return () => {
      if (!pollingActive) return;
      stopDeprecationScanPolling(clusterId);
      pollingActive = false;
    };
  });
</script>

<div class="text-nowrap">Deprecation scan:</div>
{#if summary}
  <div
    class="truncate text-xs {summary.status === 'unavailable' || summary.status === 'critical'
      ? 'text-red-400'
      : 'text-gray-500'}"
    title={summary.message}
  >
    {summary.message}
  </div>
  <div
    class="rounded-full h-3.5 w-3.5 shrink-0 {statusStyles[summary.status] ?? 'bg-slate-500'}"
  ></div>
{:else if (lazyLoad && !manuallyActivated) || bootstrapInFlight}
  <button
    type="button"
    class="inline-flex items-center gap-1 rounded-md border border-slate-400 bg-slate-700 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-slate-600 disabled:cursor-wait disabled:opacity-70"
    onclick={(e) => {
      e.stopPropagation();
      handleManualLoad();
    }}
    disabled={Boolean(bootstrapInFlight)}
    title={bootstrapInFlight
      ? "Running kubectl + helm history lookups across all namespaces..."
      : "Scans helm releases and API resources for deprecated Kubernetes APIs (kubectl api-resources + helm history). Takes a few seconds."}
  >
    {#if bootstrapInFlight}
      <span
        class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-transparent"
      ></span>
      <span>Scanning<LoadingDots /></span>
    {:else}
      Load
    {/if}
  </button>
{:else}
  <div class="truncate text-gray-500 text-xs">Scan unavailable</div>
  <div class="rounded-full h-3.5 w-3.5 shrink-0 bg-slate-500"></div>
{/if}
