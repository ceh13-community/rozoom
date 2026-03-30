<script lang="ts">
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import { Badge } from "$shared/ui/badge";
  import { STATUS_CLASSES } from "$entities/cluster";
  import { checkStorageStatus, updateClusterCheckPartially } from "$features/check-health";
  import type { StorageStatusReport } from "$features/check-health/model/types";

  interface Props {
    report: StorageStatusReport | null;
    clusterId: string;
  }

  const { report, clusterId }: Props = $props();

  let isRefreshing = $state(false);
  let isOpen = $state(false);

  const summary = $derived(report?.summary ?? null);
  const updatedAtText = $derived.by(() =>
    report?.updatedAt ? new Date(report.updatedAt).toLocaleTimeString() : "-",
  );

  const statusLabel = $derived.by(() => {
    if (!summary) return "Unknown";
    if (summary.status === "critical") return `${summary.lostPVCs} PVC lost`;
    if (summary.status === "warning") return `${summary.pendingPVCs} PVC pending`;
    if (summary.status === "ok") return `${summary.totalPVCs} PVC bound`;
    return "Unknown";
  });

  const statusClass = $derived.by(() => {
    if (!summary) return STATUS_CLASSES.unknown;
    if (summary.status === "ok") return STATUS_CLASSES.ok;
    if (summary.status === "warning") return STATUS_CLASSES.warning;
    if (summary.status === "critical") return STATUS_CLASSES.error;
    return STATUS_CLASSES.unknown;
  });

  const detailText = $derived(
    summary?.message ?? "Storage data is unavailable for this cluster.",
  );

  async function refreshNow() {
    if (isRefreshing || !clusterId) return;
    isRefreshing = true;
    try {
      const fresh = await checkStorageStatus(clusterId, { force: true });
      await updateClusterCheckPartially(clusterId, { storageStatus: fresh });
    } finally {
      isRefreshing = false;
    }
  }
</script>

<div class="pl-1 flex justify-between items-center gap-2 mb-1 mt-1 text-sm">
  <span class="font-medium text-slate-700 dark:text-slate-300">Storage:</span>
  <Popover.Root bind:open={isOpen}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Badge {...props} class={`text-white ${statusClass} cursor-pointer`}>
          {statusLabel}
        </Badge>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content class="w-[400px] max-h-[420px] overflow-y-auto" sideOffset={8}>
      <p>{detailText}</p>
      <div class="flex items-center justify-between gap-2 mb-3">
        <span class="text-xs text-muted-foreground">Last updated: {updatedAtText}</span>
        <Button
          variant="outline"
          size="sm"
          onclick={refreshNow}
          loading={isRefreshing}
          loadingLabel="Refreshing"
        >
          Refresh now
        </Button>
      </div>

      {#if summary}
        <div class="space-y-1 text-xs text-muted-foreground">
          <p>Storage classes: {summary.storageClasses}</p>
          <p>Total PVCs: {summary.totalPVCs}</p>
          <p>Bound: {summary.boundPVCs}</p>
          <p>Pending: {summary.pendingPVCs}</p>
          <p>Lost: {summary.lostPVCs}</p>
        </div>
      {/if}
    </Popover.Content>
  </Popover.Root>
</div>
