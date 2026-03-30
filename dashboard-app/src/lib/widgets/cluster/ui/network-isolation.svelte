<script lang="ts">
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import * as Table from "$shared/ui/table";
  import { Badge } from "$shared/ui/badge";
  import { STATUS_CLASSES } from "$entities/cluster";
  import { checkNetworkIsolation, updateClusterCheckPartially } from "$features/check-health";
  import type { NetworkIsolationReport } from "$features/check-health/model/types";

  interface Props {
    report: NetworkIsolationReport | null;
    clusterId: string;
  }

  const { report, clusterId }: Props = $props();

  let isRefreshing = $state(false);
  let isOpen = $state(false);

  const summary = $derived(report?.summary ?? null);
  const items = $derived(report?.items ?? []);
  const updatedAtText = $derived.by(() =>
    report?.updatedAt ? new Date(report.updatedAt).toLocaleTimeString() : "-",
  );

  const statusLabel = $derived.by(() => {
    if (!summary) return "Unknown";
    if (summary.status === "ok") return "OK";
    if (summary.status === "warning") return "Warning";
    if (summary.status === "critical") return "Critical";
    if (summary.status === "unreachable") return "Unreachable";
    if (summary.status === "insufficient") return "Insufficient permissions";
    if (summary.status === "unsupported") return "Not supported";
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
    summary?.message ? `Network: ${summary.message}` : "Network: Unknown",
  );

  const defaultDenyText = (item: NetworkIsolationReport["items"][number]) => {
    if (item.defaultDenyIngress && item.defaultDenyEgress) return "Ingress + Egress";
    if (item.defaultDenyIngress) return "Ingress";
    if (item.defaultDenyEgress) return "Egress";
    return "No";
  };

  const allowText = (item: NetworkIsolationReport["items"][number]) => {
    if (item.allowIngress && item.allowEgress) return "Ingress + Egress";
    if (item.allowIngress) return "Ingress";
    if (item.allowEgress) return "Egress";
    return "No";
  };

  async function refreshNow() {
    if (isRefreshing || !clusterId) return;
    isRefreshing = true;
    try {
      const fresh = await checkNetworkIsolation(clusterId, { force: true });
      await updateClusterCheckPartially(clusterId, { networkIsolation: fresh });
    } finally {
      isRefreshing = false;
    }
  }
</script>

<div class="pl-1 flex justify-between items-center gap-2 mb-1 mt-1 text-sm">
  <span class="font-medium text-slate-700 dark:text-slate-300">Network isolation:</span>
  <Popover.Root bind:open={isOpen}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Badge {...props} class={`text-white ${statusClass} cursor-pointer`}>
          {statusLabel}
        </Badge>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content class="w-[980px] max-h-[520px] overflow-y-auto" sideOffset={8}>
      <p>{detailText}</p>
      <div class="mb-2 text-[11px] text-muted-foreground/90">
        This summary reflects Kubernetes NetworkPolicy coverage and default-deny posture. It does not
        validate CNI-specific enforcement beyond what policy objects and observable signals expose.
      </div>
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

      {#if report?.errors}
        <div class="mb-3 rounded-md border border-slate-300 bg-slate-50 p-2 text-xs text-slate-600">
          {report.errors}
        </div>
      {/if}

      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Namespace</Table.Head>
            <Table.Head>Policies</Table.Head>
            <Table.Head>Default deny</Table.Head>
            <Table.Head>Allow rules</Table.Head>
            <Table.Head>DNS</Table.Head>
            <Table.Head>Notes</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#if items.length}
            {#each items as item (item.namespace)}
              <Table.Row>
                <Table.Cell>{item.namespace}</Table.Cell>
                <Table.Cell>{item.policyCount}</Table.Cell>
                <Table.Cell>{defaultDenyText(item)}</Table.Cell>
                <Table.Cell>{allowText(item)}</Table.Cell>
                <Table.Cell>{item.allowDns ? "Allowed" : "Missing"}</Table.Cell>
                <Table.Cell>
                  {#if item.issues.length}
                    <div>{item.issues.join("; ")}</div>
                  {:else}
                    -
                  {/if}
                  {#if item.recommendations.length}
                    <div class="mt-2 text-[10px] text-muted-foreground whitespace-pre-wrap">
                      {item.recommendations.join("\n\n")}
                    </div>
                  {/if}
                </Table.Cell>
              </Table.Row>
            {/each}
          {:else}
            <Table.Row>
              <Table.Cell colspan={6}>No network policy data available.</Table.Cell>
            </Table.Row>
          {/if}
        </Table.Body>
      </Table.Root>
    </Popover.Content>
  </Popover.Root>
</div>
