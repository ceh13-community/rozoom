<script lang="ts">
  import { onMount } from "svelte";
  import { page, navigating } from "$app/state";
  import { writeRuntimeDebugLog } from "$shared/lib/runtime-debug";
  import {
    dashboardDataProfile,
    shouldAutoRunDiagnostics,
  } from "$shared/lib/dashboard-data-profile.svelte";
  import {
    backupAuditState,
    markBackupAuditUnavailable,
    runBackupAudit,
    startBackupAuditPolling,
    stopBackupAuditPolling,
  } from "$features/backup-audit";
  import { scheduleSummaryBootstrap } from "./model/summary-bootstrap-queue";
  import LoadingDots from "$shared/ui/loading-dots.svelte";

  interface Props {
    clusterId: string;
    offline?: boolean;
    lazyLoad?: boolean;
  }

  const { clusterId, offline = false, lazyLoad = false }: Props = $props();
  let manuallyActivated = $state(false);

  const auditState = $derived($backupAuditState[clusterId]);
  const summary = $derived(auditState?.summary ?? null);
  const displayMessage = $derived.by(() => {
    const rawMessage = summary?.message ?? "Unable to verify backup";
    if (!summary || summary.status !== "unverifiable") return rawMessage;
    if (rawMessage.toLowerCase().includes('resource type "backups"')) {
      return "Velero Backup CRD is not installed";
    }
    return rawMessage;
  });
  const hasExtendedMessage = $derived(
    Boolean(summary?.message && summary.message.trim() && summary.message !== displayMessage),
  );
  let pageVisible = $state(true);
  const autoDiagnosticsEnabled = $derived(shouldAutoRunDiagnostics($dashboardDataProfile));
  const dashboardRootActive = $derived(page.url.pathname === "/dashboard" && !navigating.to);

  const statusStyles: Record<string, string> = {
    ok: "bg-emerald-500",
    outdated: "bg-amber-500",
    missing: "bg-rose-600",
    failed: "bg-rose-600",
    unverifiable: "bg-slate-500",
  };

  const statusEmoji: Record<string, string> = {
    ok: "✅",
    outdated: "🟠",
    missing: "❌",
    failed: "❌",
    unverifiable: "⚠️",
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
    void writeRuntimeDebugLog("runtime", "backup_summary_bootstrap_requested", { clusterId });
    bootstrapInFlight = scheduleSummaryBootstrap(clusterId, "backup", () =>
      runBackupAudit(clusterId, { source: "auto" }).then(() => undefined),
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
        void writeRuntimeDebugLog("runtime", "backup_summary_visible", {
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
        stopBackupAuditPolling(clusterId);
        pollingActive = false;
      }
      return;
    }

    if (offline) {
      if (pollingActive) {
        void writeRuntimeDebugLog("runtime", "backup_summary_poll_stopped", {
          clusterId,
          reason: "offline",
        });
        stopBackupAuditPolling(clusterId);
        pollingActive = false;
      }
      markBackupAuditUnavailable(clusterId, "Backup status unavailable: cluster is offline");
      return;
    }

    if (!autoDiagnosticsEnabled) {
      if (pollingActive) {
        void writeRuntimeDebugLog("runtime", "backup_summary_poll_stopped", {
          clusterId,
          reason: "auto_diagnostics_disabled",
        });
        stopBackupAuditPolling(clusterId);
        pollingActive = false;
      }
      return;
    }

    if (!dashboardRootActive) {
      if (pollingActive) {
        void writeRuntimeDebugLog("runtime", "backup_summary_poll_stopped", {
          clusterId,
          reason: "dashboard_inactive",
        });
        stopBackupAuditPolling(clusterId);
        pollingActive = false;
      }
      return;
    }

    if (!pageVisible) {
      if (pollingActive) {
        void writeRuntimeDebugLog("runtime", "backup_summary_poll_stopped", {
          clusterId,
          reason: "page_hidden",
        });
        stopBackupAuditPolling(clusterId);
        pollingActive = false;
      }
      return;
    }

    if (!pollingActive) {
      void writeRuntimeDebugLog("runtime", "backup_summary_poll_started", { clusterId });
      startBackupAuditPolling(clusterId);
      pollingActive = true;
    }

    return () => {
      if (!pollingActive) return;
      stopBackupAuditPolling(clusterId);
      pollingActive = false;
    };
  });
</script>

<div>Backup status:</div>
{#if summary}
  <div class="flex min-w-0 items-start gap-1 text-xs text-gray-500">
    <div class="min-w-0 whitespace-normal break-words leading-snug" title={summary.message}>
      {displayMessage}
    </div>
    {#if hasExtendedMessage}
      <button
        class="shrink-0 rounded-sm px-1 text-[10px] font-medium uppercase tracking-wide text-slate-500 underline decoration-dotted underline-offset-2 transition-colors hover:text-slate-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        type="button"
        title={summary.message}
        aria-label="Show backup warning details"
      >
        details
      </button>
    {/if}
  </div>
  <div>
    {statusEmoji[summary.status]}
  </div>
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
      ? "Listing Velero Backup and Schedule resources in-cluster..."
      : "Reads Velero Backup + Schedule CRs to report the latest backup age and status (kubectl get backup/schedule). Fast on clusters with a velero namespace; shows 'unavailable' otherwise."}
  >
    {#if bootstrapInFlight}
      <span
        class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-transparent"
      ></span>
      <span>Checking<LoadingDots /></span>
    {:else}
      Load
    {/if}
  </button>
{:else}
  <div>Unable to verify backup</div>
  <div>{statusEmoji.unverifiable}</div>
{/if}
