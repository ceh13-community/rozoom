<script lang="ts">
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import { Badge } from "$shared/ui/badge";
  import { STATUS_CLASSES } from "$entities/cluster";
  import { checkRbacOverview, updateClusterCheckPartially } from "$features/check-health";
  import type { RbacOverviewReport } from "$features/check-health/model/types";

  interface Props {
    report: RbacOverviewReport | null;
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
    if (summary.status === "warning")
      return `${summary.overprivilegedCount} cluster-admin`;
    if (summary.status === "ok") return "OK";
    return "Unknown";
  });

  const statusClass = $derived.by(() => {
    if (!summary) return STATUS_CLASSES.unknown;
    if (summary.status === "ok") return STATUS_CLASSES.ok;
    if (summary.status === "warning") return STATUS_CLASSES.warning;
    return STATUS_CLASSES.unknown;
  });

  const detailText = $derived(
    summary?.message ?? "RBAC data is unavailable for this cluster.",
  );

  async function refreshNow() {
    if (isRefreshing || !clusterId) return;
    isRefreshing = true;
    try {
      const fresh = await checkRbacOverview(clusterId, { force: true });
      await updateClusterCheckPartially(clusterId, { rbacOverview: fresh });
    } finally {
      isRefreshing = false;
    }
  }
</script>

<div class="pl-1 flex justify-between items-center gap-2 mb-1 mt-1 text-sm">
  <span class="font-medium text-slate-700 dark:text-slate-300">RBAC:</span>
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
          <p>Total bindings: {summary.totalBindings}</p>
          <p>cluster-admin bindings: {summary.clusterAdminBindings}</p>
          <p>Non-system cluster-admin: {summary.overprivilegedCount}</p>
        </div>
      {/if}
    </Popover.Content>
  </Popover.Root>
</div>
