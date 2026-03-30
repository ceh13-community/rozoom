<script lang="ts">
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import * as Table from "$shared/ui/table";
  import { Badge } from "$shared/ui/badge";
  import { STATUS_CLASSES } from "$entities/cluster";
  import { checkProbesHealth, updateClusterCheckPartially } from "$features/check-health";
  import type { ProbeSummary, ProbesHealthReport } from "$features/check-health/model/types";

  interface Props {
    report: ProbesHealthReport | null;
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
    return "Unknown";
  });

  const statusClass = $derived.by(() => {
    if (!summary) return STATUS_CLASSES.unknown;
    if (summary.status === "ok") return STATUS_CLASSES.ok;
    if (summary.status === "warning") return STATUS_CLASSES.warning;
    if (summary.status === "critical") return STATUS_CLASSES.error;
    return STATUS_CLASSES.unknown;
  });

  const detailText = $derived(summary?.message ? `Probes: ${summary.message}` : "Probes: Unknown");

  function formatProbe(probe: ProbeSummary): string {
    if (probe.type === "missing") return "missing";
    if (probe.type === "unknown") return "unknown";

    const timings: string[] = [];
    if (probe.initialDelaySeconds !== undefined) {
      timings.push(`delay ${probe.initialDelaySeconds}s`);
    }
    if (probe.timeoutSeconds !== undefined) {
      timings.push(`timeout ${probe.timeoutSeconds}s`);
    }
    if (probe.periodSeconds !== undefined) {
      timings.push(`period ${probe.periodSeconds}s`);
    }
    if (probe.failureThreshold !== undefined) {
      timings.push(`fail ${probe.failureThreshold}`);
    }
    if (probe.successThreshold !== undefined) {
      timings.push(`success ${probe.successThreshold}`);
    }

    return timings.length > 0 ? `${probe.type} (${timings.join(", ")})` : probe.type;
  }

  async function refreshNow() {
    if (isRefreshing || !clusterId) return;
    isRefreshing = true;
    try {
      const fresh = await checkProbesHealth(clusterId, { force: true });
      await updateClusterCheckPartially(clusterId, { probesHealth: fresh });
    } finally {
      isRefreshing = false;
    }
  }
</script>

<div class="pl-1 flex justify-between items-center gap-2 mb-1 mt-1 text-sm">
  <span class="font-medium text-slate-700 dark:text-slate-300">Probes health:</span>
  <Popover.Root>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Badge {...props} class={`text-white ${statusClass} cursor-pointer`}>
          {statusLabel}
        </Badge>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content class="w-[980px] max-h-[420px] overflow-y-auto" sideOffset={8}>
      <p>{detailText}</p>
      <div class="mb-2 text-[11px] text-muted-foreground/90">
        This summary evaluates readiness, liveness, and startup probe configuration against the
        documented Kubernetes probe model. It highlights misconfiguration risk, not runtime success
        rates of every probe execution.
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
            <Table.Head>Workload/Container</Table.Head>
            <Table.Head>Readiness</Table.Head>
            <Table.Head>Liveness</Table.Head>
            <Table.Head>Startup</Table.Head>
            <Table.Head>Status</Table.Head>
            <Table.Head>Issues</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#if items.length}
            {#each items as item (item.namespace + item.workload + item.container)}
              <Table.Row>
                <Table.Cell>{item.namespace}</Table.Cell>
                <Table.Cell>
                  {item.workloadType}/{item.workload}
                  <div class="text-[10px] text-muted-foreground">{item.container}</div>
                </Table.Cell>
                <Table.Cell>{formatProbe(item.readiness)}</Table.Cell>
                <Table.Cell>{formatProbe(item.liveness)}</Table.Cell>
                <Table.Cell>{formatProbe(item.startup)}</Table.Cell>
                <Table.Cell>{item.status}</Table.Cell>
                <Table.Cell>
                  {#if item.issues.length}
                    <div>{item.issues.join("; ")}</div>
                  {:else}
                    -
                  {/if}
                  {#if item.hints.length}
                    <div class="text-[10px] text-muted-foreground">{item.hints.join(" ")}</div>
                  {/if}
                </Table.Cell>
              </Table.Row>
            {/each}
          {:else}
            <Table.Row>
              <Table.Cell colspan={7}>No workload probe data available.</Table.Cell>
            </Table.Row>
          {/if}
        </Table.Body>
      </Table.Root>
    </Popover.Content>
  </Popover.Root>
</div>
