<script lang="ts">
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import { Badge } from "$shared/ui/badge";
  import { STATUS_CLASSES } from "$entities/cluster";
  import { checkServiceMesh, updateClusterCheckPartially } from "$features/check-health";
  import type { ServiceMeshReport } from "$features/check-health/model/types";

  interface Props {
    report: ServiceMeshReport | null;
    clusterId: string;
  }

  const { report, clusterId }: Props = $props();

  let isRefreshing = $state(false);
  let isOpen = $state(false);

  const updatedAtText = $derived.by(() =>
    report?.updatedAt ? new Date(report.updatedAt).toLocaleTimeString() : "-",
  );

  const badgeLabel = $derived.by(() => {
    if (!report) return "Unknown";
    if (report.meshType === "istio") return "Istio";
    if (report.meshType === "linkerd") return "Linkerd";
    return "none";
  });

  const statusClass = $derived.by(() => {
    if (!report) return STATUS_CLASSES.unknown;
    if (report.detected) return STATUS_CLASSES.ok;
    return STATUS_CLASSES.unknown;
  });

  async function refreshNow() {
    if (isRefreshing || !clusterId) return;
    isRefreshing = true;
    try {
      const fresh = await checkServiceMesh(clusterId, { force: true });
      await updateClusterCheckPartially(clusterId, { serviceMesh: fresh });
    } finally {
      isRefreshing = false;
    }
  }
</script>

<div class="pl-1 flex justify-between items-center gap-2 mb-1 mt-1 text-sm">
  <span class="font-medium text-slate-700 dark:text-slate-300">Service Mesh:</span>
  <Popover.Root bind:open={isOpen}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Badge {...props} class={`text-white ${statusClass} cursor-pointer`}>
          {badgeLabel}
        </Badge>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content class="w-[340px] max-h-[300px] overflow-y-auto" sideOffset={8}>
      <p>Service Mesh: {badgeLabel}</p>
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
      <p class="text-xs text-muted-foreground">
        {#if report?.detected}
          Detected <strong>{report.meshType}</strong> service mesh CRDs in the cluster.
        {:else}
          No service mesh CRDs detected (checked for Istio and Linkerd).
        {/if}
      </p>
    </Popover.Content>
  </Popover.Root>
</div>
