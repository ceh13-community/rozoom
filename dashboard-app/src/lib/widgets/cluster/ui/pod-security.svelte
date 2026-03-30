<script lang="ts">
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import * as Table from "$shared/ui/table";
  import { Badge } from "$shared/ui/badge";
  import { STATUS_CLASSES } from "$entities/cluster";
  import { checkPodSecurity, updateClusterCheckPartially } from "$features/check-health";
  import type { PodSecurityReport } from "$features/check-health/model/types";

  interface Props {
    report: PodSecurityReport | null;
    clusterId: string;
  }

  const { report, clusterId }: Props = $props();

  let isRefreshing = $state(false);
  let isOpen = $state(false);

  const summary = $derived(report?.summary ?? null);
  const namespaces = $derived(report?.namespaces ?? []);
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

  const detailText = $derived(
    summary?.message ? `Pod Security: ${summary.message}` : "Pod Security: Unknown",
  );

  async function refreshNow() {
    if (isRefreshing || !clusterId) return;
    isRefreshing = true;
    try {
      const fresh = await checkPodSecurity(clusterId, { force: true });
      await updateClusterCheckPartially(clusterId, { podSecurity: fresh });
    } finally {
      isRefreshing = false;
    }
  }
</script>

<div class="pl-1 flex justify-between items-center gap-2 mb-1 mt-1 text-sm">
  <span class="font-medium text-slate-700 dark:text-slate-300">Pod Security:</span>
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
        This summary is based on Pod Security Admission labels plus observed workload posture. It is
        guidance against the Kubernetes Pod Security Standards, not a built-in cluster verdict.
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

      <div class="mb-3 text-xs font-semibold text-slate-700">Namespaces (PSA)</div>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Namespace</Table.Head>
            <Table.Head>Enforce</Table.Head>
            <Table.Head>Warn</Table.Head>
            <Table.Head>Audit</Table.Head>
            <Table.Head>Notes</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#if namespaces.length}
            {#each namespaces as item (item.namespace)}
              <Table.Row>
                <Table.Cell>{item.namespace}</Table.Cell>
                <Table.Cell>{item.enforce}</Table.Cell>
                <Table.Cell>{item.warn}</Table.Cell>
                <Table.Cell>{item.audit}</Table.Cell>
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
              <Table.Cell colspan={5}>No namespace PSA data available.</Table.Cell>
            </Table.Row>
          {/if}
        </Table.Body>
      </Table.Root>

      <div class="mt-4 mb-3 text-xs font-semibold text-slate-700">Pods (PSS)</div>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Namespace</Table.Head>
            <Table.Head>Pod</Table.Head>
            <Table.Head>Container</Table.Head>
            <Table.Head>Enforce</Table.Head>
            <Table.Head>Notes</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#if items.length}
            {#each items as item (item.namespace + item.pod + item.container)}
              <Table.Row>
                <Table.Cell>{item.namespace}</Table.Cell>
                <Table.Cell>{item.pod}</Table.Cell>
                <Table.Cell>{item.container}</Table.Cell>
                <Table.Cell>{item.enforceLevel}</Table.Cell>
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
              <Table.Cell colspan={5}>No pod security violations detected.</Table.Cell>
            </Table.Row>
          {/if}
        </Table.Body>
      </Table.Root>
    </Popover.Content>
  </Popover.Root>
</div>
