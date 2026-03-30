<script lang="ts">
  import { onMount } from "svelte";
  import { page, navigating } from "$app/state";
  import { writeRuntimeDebugLog } from "$shared/lib/runtime-debug";
  import {
    dashboardDataProfile,
    shouldAutoRunDiagnostics,
  } from "$shared/lib/dashboard-data-profile.svelte";
  import {
    markVersionAuditUnavailable,
    runVersionAudit,
    startVersionAuditPolling,
    stopVersionAuditPolling,
    versionAuditState,
  } from "$features/version-audit";
  import { scheduleSummaryBootstrap } from "./model/summary-bootstrap-queue";
  import LoadingDots from "$shared/ui/loading-dots.svelte";

  interface Props {
    clusterId: string;
    offline?: boolean;
    lazyLoad?: boolean;
  }

  const { clusterId, offline = false, lazyLoad = false }: Props = $props();
  let manuallyActivated = $state(false);

  const auditState = $derived($versionAuditState[clusterId]);
  const summary = $derived(auditState?.summary ?? null);
  let pageVisible = $state(true);
  const autoDiagnosticsEnabled = $derived(shouldAutoRunDiagnostics($dashboardDataProfile));
  const dashboardRootActive = $derived(page.url.pathname === "/dashboard" && !navigating.to);

  const statusStyles: Record<string, string> = {
    ok: "bg-emerald-500",
    outdated: "bg-amber-500",
    unsupported: "bg-rose-600",
    unreachable: "bg-slate-500",
  };

  const statusEmoji: Record<string, string> = {
    ok: "✅",
    outdated: "🟠",
    unsupported: "❌",
    unreachable: "⚠️",
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
    void writeRuntimeDebugLog("runtime", "version_summary_bootstrap_requested", { clusterId });
    bootstrapInFlight = scheduleSummaryBootstrap(clusterId, "version", () =>
      runVersionAudit(clusterId, { source: "auto" }).then(() => undefined),
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
      const visibleLogKey = `${clusterId}:${summary.k8sStatus}:${summary.k8sVersion ?? "unknown"}`;
      if (lastVisibleLogKey !== visibleLogKey) {
        lastVisibleLogKey = visibleLogKey;
        void writeRuntimeDebugLog("runtime", "version_summary_visible", {
          clusterId,
          k8sStatus: summary.k8sStatus,
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
        stopVersionAuditPolling(clusterId);
        pollingActive = false;
      }
      return;
    }

    if (offline) {
      if (pollingActive) {
        void writeRuntimeDebugLog("runtime", "version_summary_poll_stopped", { clusterId, reason: "offline" });
        stopVersionAuditPolling(clusterId);
        pollingActive = false;
      }
      markVersionAuditUnavailable(clusterId, "Version audit unavailable: cluster is offline");
      return;
    }

    if (!autoDiagnosticsEnabled) {
      if (pollingActive) {
        void writeRuntimeDebugLog("runtime", "version_summary_poll_stopped", {
          clusterId,
          reason: "auto_diagnostics_disabled",
        });
        stopVersionAuditPolling(clusterId);
        pollingActive = false;
      }
      return;
    }

    if (!dashboardRootActive) {
      if (pollingActive) {
        void writeRuntimeDebugLog("runtime", "version_summary_poll_stopped", {
          clusterId,
          reason: "dashboard_inactive",
        });
        stopVersionAuditPolling(clusterId);
        pollingActive = false;
      }
      return;
    }

    if (!pageVisible) {
      if (pollingActive) {
        void writeRuntimeDebugLog("runtime", "version_summary_poll_stopped", {
          clusterId,
          reason: "page_hidden",
        });
        stopVersionAuditPolling(clusterId);
        pollingActive = false;
      }
      return;
    }

    if (!pollingActive) {
      void writeRuntimeDebugLog("runtime", "version_summary_poll_started", { clusterId });
      startVersionAuditPolling(clusterId);
      pollingActive = true;
    }

    return () => {
      if (!pollingActive) return;
      stopVersionAuditPolling(clusterId);
      pollingActive = false;
    };
  });
</script>

<div>K8s version:</div>
{#if summary}
  <div class="truncate text-gray-500 text-xs">
    {summary.k8sVersion ?? "Unknown"}
  </div>
  <div>
    {statusEmoji[summary.k8sStatus]}
  </div>
{:else if lazyLoad && !manuallyActivated}
  <button
    type="button"
    class="rounded-md border border-slate-400 bg-slate-700 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-slate-600"
    onclick={(e) => { e.stopPropagation(); handleManualLoad(); }}
  >
    Load
  </button>
{:else if bootstrapInFlight}
  <div class="truncate text-gray-500 text-xs">Loading<LoadingDots /></div>
  <div class="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"></div>
{:else}
  <div class="truncate text-gray-500 text-xs">Unreachable</div>
  <div>{statusEmoji.unreachable}</div>
{/if}
