<script lang="ts">
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import * as Table from "$shared/ui/table";
  import { STATUS_CLASSES } from "$entities/cluster";
  import { checkCertificatesHealth, updateClusterCheckPartially } from "$features/check-health";
  import type { CertificatesReport } from "$features/check-health/model/types";
  import { Badge } from "$shared/ui/badge";

  interface Props {
    health: CertificatesReport | null;
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

  const summaryText = $derived(health?.summary.message ?? "No certificate data.");
  const warnings = $derived(health?.summary.warnings ?? []);
  const updatedAtText = $derived.by(() =>
    health?.updatedAt ? new Date(health.updatedAt).toLocaleTimeString() : "-",
  );

  function formatDays(days?: number): string {
    if (days === undefined || !Number.isFinite(days)) return "-";
    return `${Math.floor(days)} days`;
  }

  async function refreshCertificatesNow() {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      const fresh = await checkCertificatesHealth(clusterId, { force: true });
      await updateClusterCheckPartially(clusterId, { certificatesHealth: fresh });
    } finally {
      isRefreshing = false;
    }
  }
</script>

<div class="pl-1 text-sm flex justify-between items-center gap-3 mb-1 mt-1">
  <span
    class="font-medium leading-5 text-slate-800 dark:text-slate-200"
    title="Control-plane certificate expiration and kubelet rotation status.">Certificates:</span
  >
  <Popover.Root bind:open={isOpen}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Badge {...props} class={`min-w-24 justify-center text-white ${statusClass} cursor-pointer`}>
          {statusLabel}
        </Badge>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content class="w-[680px] max-h-[420px] overflow-y-auto" sideOffset={8}>
      <div class="flex items-center justify-between gap-2 mb-3">
        <span class="text-xs text-muted-foreground">Last updated: {updatedAtText}</span>
        <Button
          variant="outline"
          size="sm"
          onclick={refreshCertificatesNow}
          loading={isRefreshing}
          loadingLabel="Refreshing"
        >
          Check now
        </Button>
      </div>

      <div class="text-xs text-muted-foreground mb-1">{summaryText}</div>
      <div class="text-[11px] text-muted-foreground/90 mb-3">
        Certificate checks are intentionally cached-first on cluster cards. Use `Check now` when you
        want a fresh control-plane and kubelet rotation probe.
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

      <div class="space-y-4 text-xs">
        <div>
          <div class="font-semibold mb-1">Control-plane certificates</div>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>Component</Table.Head>
                <Table.Head>Expires on</Table.Head>
                <Table.Head>Days left</Table.Head>
                <Table.Head>Status</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#if health?.certificates?.length}
                {#each health.certificates as item (item.name)}
                  <Table.Row>
                    <Table.Cell>{item.name}</Table.Cell>
                    <Table.Cell>{item.expiresAt ?? "-"}</Table.Cell>
                    <Table.Cell>{formatDays(item.daysLeft)}</Table.Cell>
                    <Table.Cell class="capitalize">{item.status}</Table.Cell>
                  </Table.Row>
                {/each}
              {:else}
                <Table.Row>
                  <Table.Cell colspan={4}>No certificate data available.</Table.Cell>
                </Table.Row>
              {/if}
            </Table.Body>
          </Table.Root>
        </div>

        <div>
          <div class="font-semibold mb-1">Kubelet rotation</div>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>Node</Table.Head>
                <Table.Head>Rotate client</Table.Head>
                <Table.Head>Rotate server</Table.Head>
                <Table.Head>Status</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#if health?.kubeletRotation?.length}
                {#each health.kubeletRotation as item (item.node)}
                  <Table.Row>
                    <Table.Cell>{item.node}</Table.Cell>
                    <Table.Cell>
                      {item.rotateClient === undefined ? "-" : item.rotateClient ? "Yes" : "No"}
                    </Table.Cell>
                    <Table.Cell>
                      {item.rotateServer === undefined ? "-" : item.rotateServer ? "Yes" : "No"}
                    </Table.Cell>
                    <Table.Cell class="capitalize">{item.status}</Table.Cell>
                  </Table.Row>
                {/each}
              {:else}
                <Table.Row>
                  <Table.Cell colspan={4}>No kubelet rotation data available.</Table.Cell>
                </Table.Row>
              {/if}
            </Table.Body>
          </Table.Root>
        </div>
      </div>
    </Popover.Content>
  </Popover.Root>
</div>
