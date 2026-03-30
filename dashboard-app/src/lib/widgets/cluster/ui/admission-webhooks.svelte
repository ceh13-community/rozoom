<script lang="ts">
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import * as Table from "$shared/ui/table";
  import { STATUS_CLASSES } from "$entities/cluster";
  import { checkAdmissionWebhooks, updateClusterCheckPartially } from "$features/check-health";
  import type { AdmissionWebhookReport } from "$features/check-health/model/types";
  import { Badge } from "$shared/ui/badge";

  interface Props {
    health: AdmissionWebhookReport | null;
    clusterId: string;
  }

  const { health, clusterId }: Props = $props();

  let isRefreshing = $state(false);
  let isOpen = $state(false);

  const statusLabel = $derived.by(() => {
    if (!health) return "Unknown";
    if (health.status === "ok") return "OK";
    if (health.status === "warning") return "Warning";
    if (health.status === "critical") return "Critical";
    return "Unknown";
  });

  const statusClass = $derived.by(() => {
    if (!health) return STATUS_CLASSES.unknown;
    if (health.status === "ok") return STATUS_CLASSES.ok;
    if (health.status === "warning") return STATUS_CLASSES.warning;
    if (health.status === "critical") return STATUS_CLASSES.error;
    return STATUS_CLASSES.unknown;
  });

  const summaryText = $derived(health?.summary.message ?? "Admission webhook metrics unavailable.");
  const warnings = $derived(health?.summary.warnings ?? []);
  const updatedAtText = $derived.by(() =>
    health?.updatedAt ? new Date(health.updatedAt).toLocaleTimeString() : "-",
  );

  function formatLatency(value?: number): string {
    return value === undefined ? "-" : `${value.toFixed(2)}s`;
  }

  function formatRate(value?: number): string {
    return value === undefined ? "-" : `${value.toFixed(2)}/min`;
  }

  async function refreshAdmissionWebhooks() {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      const fresh = await checkAdmissionWebhooks(clusterId, { force: true });
      await updateClusterCheckPartially(clusterId, { admissionWebhooks: fresh });
    } finally {
      isRefreshing = false;
    }
  }
</script>

<div class="pl-1 text-sm flex justify-between items-center gap-2 mb-1 mt-1">
  <span
    class="font-medium text-slate-700 dark:text-slate-300"
    title="Admission webhook latency and error indicators from apiserver metrics."
  >
    Admission Webhooks:
  </span>

  <Popover.Root bind:open={isOpen}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Badge {...props} class={`text-white ${statusClass} cursor-pointer`}>
          {statusLabel}
        </Badge>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content class="w-[720px] max-h-[420px] overflow-y-auto">
      <div class="flex items-center justify-between gap-2 mb-3">
        <span class="text-xs text-muted-foreground">Last updated: {updatedAtText}</span>
        <Button
          variant="outline"
          size="sm"
          onclick={refreshAdmissionWebhooks}
          loading={isRefreshing}
          loadingLabel="Refreshing"
        >
          Check now
        </Button>
      </div>

      <div class="text-xs text-muted-foreground mb-1">{summaryText}</div>
      <div class="text-[11px] text-muted-foreground/90 mb-3">
        This summary is derived from kube-apiserver admission webhook metrics. It highlights latency,
        reject, and fail-open behavior, not the functional correctness of every webhook policy.
      </div>

      {#if warnings.length}
        <div class="mb-3 rounded-md border border-orange-400/40 bg-orange-400/10 p-2 text-xs">
          <div class="font-semibold text-orange-400">Warnings</div>
          <ul class="list-disc pl-4">
            {#each warnings as warning}
              <li>{warning}</li>
            {/each}
          </ul>
        </div>
      {/if}

      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Webhook</Table.Head>
            <Table.Head>Operation</Table.Head>
            <Table.Head>Type</Table.Head>
            <Table.Head>p99</Table.Head>
            <Table.Head>Rejects</Table.Head>
            <Table.Head>Fail-open</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#if health?.items?.length}
            {#each health.items as item (item.name + (item.operation ?? "") + (item.type ?? ""))}
              <Table.Row>
                <Table.Cell>{item.name}</Table.Cell>
                <Table.Cell>{item.operation ?? "-"}</Table.Cell>
                <Table.Cell>{item.type ?? "-"}</Table.Cell>
                <Table.Cell>{formatLatency(item.latency.p99)}</Table.Cell>
                <Table.Cell>{formatRate(item.rejectRate)}</Table.Cell>
                <Table.Cell>{formatRate(item.failOpenRate)}</Table.Cell>
              </Table.Row>
            {/each}
          {:else}
            <Table.Row>
              <Table.Cell colspan={6}>No admission webhook metrics found.</Table.Cell>
            </Table.Row>
          {/if}
        </Table.Body>
      </Table.Root>
    </Popover.Content>
  </Popover.Root>
</div>
