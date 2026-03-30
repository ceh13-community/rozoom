<script lang="ts">
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import {
    installKubeStateMetrics,
    installMetricsServer,
    installNodeExporter,
    uninstallKubeStateMetrics,
    uninstallMetricsServer,
    uninstallNodeExporter,
  } from "$shared/api/helm";
  import { deleteKubeStateMetricsManifests } from "$shared/api/kube-state-metrics";
  import { deleteMetricsServerManifests } from "$shared/api/metrics-server";
  import { deleteNodeExporterManifests } from "$shared/api/node-exporter";
  import type { CheckMetricResult } from "$features/check-health/model/types";

  interface Props {
    metrics: CheckMetricResult;
    clusterId: string;
    onRefresh?: () => Promise<void> | void;
  }

  const { metrics, clusterId, onRefresh }: Props = $props();
  // let showDetails = $state(false);
  let actionState = $state<{ status: "idle" | "working" | "error" | "success"; message?: string }>({
    status: "idle",
  });

  function formatMetricsStatus(status: unknown): string {
    if (typeof status === "string") return status;
    if (Array.isArray(status)) {
      const values = status
        .map((entry) => {
          if (typeof entry === "string") return entry;
          if (entry && typeof entry === "object" && "result" in entry) {
            const result = (entry as { result?: unknown }).result;
            if (result === 1) return "Available";
            if (result === 0) return "Unreachable";
            if (result === 2) return "Timeout";
            if (result === -1) return "Not found";
          }
          return null;
        })
        .filter((value): value is string => Boolean(value));
      return values.join(", ") || "Unknown";
    }
    if (status && typeof status === "object" && "result" in status) {
      const result = (status as { result?: unknown }).result;
      if (result === 1) return "Available";
      if (result === 0) return "Unreachable";
      if (result === 2) return "Timeout";
      if (result === -1) return "Not found";
    }
    return "Unknown";
  }

  const statusLabel = $derived.by(() => formatMetricsStatus(metrics.status));
  const isKubeStateMetrics = $derived(metrics.title === "Kube State Metrics");
  const isAvailable = $derived(statusLabel.includes("Available"));
  const isInstalled = $derived(metrics.installed === true && isAvailable);
  const isMissing = $derived(metrics.installed !== true || !isAvailable);
  const isHelmManaged = $derived(metrics.managedBy === "helm");
  const isKubectlManaged = $derived(metrics.managedBy === "kubectl");
  const helmReleaseName = $derived(metrics.releaseName ?? "unknown");
  const isMetricsServer = $derived(metrics.title === "Metrics Server");
  const isNodeExporter = $derived(metrics.title === "Node Exporter");
  const isActionable = $derived(isKubeStateMetrics || isMetricsServer || isNodeExporter);
  const description = $derived.by(() => {
    const map: Record<string, string> = {
      "Kube State Metrics": "Cluster-state metrics from kube-state-metrics. Useful for dashboards and alerts, but not required for core Kubernetes health.",
      Kubelet: "Kubelet summary/resource metrics per node. Core signal for node resource visibility.",
      "Metrics Server": "Resource Metrics API used by kubectl top and autoscaling flows.",
      "Node Exporter": "Host-level metrics from node-exporter, usually for Prometheus-based observability stacks.",
    };
    return map[metrics.title] ?? "Metrics endpoint availability and install status.";
  });

  let lastSyncSeen = $state("");
  let isOpen = $state(false);

  $effect(() => {
    if (!lastSyncSeen) {
      lastSyncSeen = metrics.lastSync;
      return;
    }
    if (lastSyncSeen !== metrics.lastSync) {
      lastSyncSeen = metrics.lastSync;
      if (actionState.status === "working") {
        actionState = { status: "idle" };
      }
    }
  });

  // $effect(() => {
  //   if (!showDetails && actionState.status !== "idle") {
  //     actionState = { status: "idle" };
  //   }
  // });

  // function toggleDetails() {
  //   showDetails = !showDetails;
  // }

  async function handleInstall() {
    if (actionState.status === "working") return;
    actionState = { status: "working" };

    let result;
    try {
      if (isKubeStateMetrics) {
        result = await installKubeStateMetrics(clusterId);
      } else if (isMetricsServer) {
        result = await installMetricsServer(clusterId);
      } else if (isNodeExporter) {
        result = await installNodeExporter(clusterId);
      } else {
        result = { success: false, error: "Unsupported install target" };
      }
    } catch (error) {
      actionState = {
        status: "error",
        message: error instanceof Error ? error.message : "Failed to install",
      };
      return;
    }
    if (!result.success) {
      const message = result.error?.trim() || "Failed to install";
      actionState = { status: "error", message };
      return;
    }

    actionState = {
      status: "success",
      message: "Install command completed. Status will update after refresh.",
    };
    await onRefresh?.();
  }

  async function handleUninstall() {
    if (actionState.status === "working") return;
    actionState = { status: "working" };

    let result;
    try {
      if (isKubeStateMetrics) {
        result = isHelmManaged
          ? await uninstallKubeStateMetrics(clusterId, metrics.namespace, metrics.releaseName)
          : await deleteKubeStateMetricsManifests(clusterId);
      } else if (isMetricsServer) {
        result = isHelmManaged
          ? await uninstallMetricsServer(clusterId, metrics.namespace, metrics.releaseName)
          : await deleteMetricsServerManifests(clusterId);
      } else if (isNodeExporter) {
        result = isHelmManaged
          ? await uninstallNodeExporter(clusterId, metrics.namespace, metrics.releaseName)
          : await deleteNodeExporterManifests(clusterId);
      } else {
        result = { success: false, error: "Unsupported uninstall target" };
      }
    } catch (error) {
      actionState = {
        status: "error",
        message: error instanceof Error ? error.message : "Failed to uninstall",
      };
      return;
    }
    if (!result.success) {
      const message = result.error?.trim() || "Failed to uninstall";
      actionState = { status: "error", message };
      return;
    }

    actionState = {
      status: "success",
      message: isHelmManaged ? "Removed via Helm" : "Removed via kubectl",
    };
    await onRefresh?.();
  }
</script>

<div class="pl-1 text-sm flex justify-between items-center gap-3 mb-1 mt-1">
  <span class="font-medium leading-5 text-slate-800 dark:text-slate-200" title={description}
    >{metrics.title}:</span
  >

  <Popover.Root bind:open={isOpen}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <span
          {...props}
          class="cursor-pointer rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800 shadow-sm dark:bg-slate-600 dark:text-slate-100"
        >
          {statusLabel}
        </span>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content class="w-[460px] max-h-[420px] overflow-y-auto" sideOffset={8}>
      <div class="my-2 p-2">
        <div class="mb-2 text-[11px] text-muted-foreground/90">
          This row shows metrics-source availability, not full observability coverage. `Metrics Server`
          powers resource metrics APIs, while `kube-state-metrics` and `node-exporter` are usually
          optional observability stack components.
        </div>
        Last sync: {metrics.lastSync}<br />
        {#if metrics.error}
          <div class="text-red-400">Error: {metrics.error}</div>
        {/if}
        {#if metrics.url}
          URL: {metrics.url}
        {/if}
        {#if isActionable}
          <div class="mt-2 flex flex-col gap-2">
            {#if isMissing}
              <div class="text-xs text-gray-600 dark:text-gray-200">
                {#if metrics.installed === true}
                  {metrics.title} is detected, but its metrics endpoint is not available yet.
                {:else}
                  {metrics.title} is not installed.
                {/if}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onclick={handleInstall}
                loading={actionState.status === "working"}
                loadingLabel="Installing"
              >
                Install
              </Button>
            {:else if isInstalled}
              {#if isKubectlManaged}
                <div class="text-xs text-gray-600 dark:text-gray-200">
                  Installed without Helm. Deleting will remove labeled resources via kubectl.
                </div>
              {/if}
              {#if isHelmManaged}
                <div class="text-xs text-gray-600 dark:text-gray-200">
                  Installed via Helm release {helmReleaseName}.
                </div>
              {/if}
              <!-- <Button
                variant="destructive"
                size="sm"
                onclick={handleUninstall}
                disabled={actionState.status === "working"}
              >
                {actionState.status === "working"
                  ? "Deleting..."
                  : isHelmManaged
                    ? "Delete (Helm)"
                    : "Delete (kubectl)"}
              </Button> -->
            {/if}
            {#if actionState.status === "error"}
              <div class="text-red-400">Error: {actionState.message}</div>
            {/if}
            {#if actionState.status === "success"}
              <div class="text-emerald-400">{actionState.message}</div>
            {/if}
          </div>
        {/if}
      </div>
    </Popover.Content>
  </Popover.Root>
</div>
