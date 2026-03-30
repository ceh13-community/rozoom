<script lang="ts">
  import * as Alert from "$shared/ui/alert";
  import DataTable from "./workloads-table.svelte";
  import type { ColumnDef } from "@tanstack/table-core";
  import LoadingDots from "$shared/ui/loading-dots.svelte";

  type EventRow = {
    uid: string;
    reason: string;
    object: string;
    message: string;
    name: string;
    date: string;
  };

  interface Props {
    rows: EventRow[];
    loading: boolean;
    error: string | null;
    columns: ColumnDef<EventRow>[];
  }

  const { rows, loading, error, columns }: Props = $props();
</script>

{#if loading && rows.length === 0}
  <div class="text-sm text-muted-foreground">Loading events<LoadingDots /></div>
{:else if error && rows.length === 0}
  <Alert.Root variant="destructive">
    <Alert.Title>Events unavailable</Alert.Title>
    <Alert.Description>{error}</Alert.Description>
  </Alert.Root>
{:else}
  {#if loading}
    <div class="mb-2 text-xs text-muted-foreground">Updating events…</div>
  {/if}
  {#if error}
    <Alert.Root variant="destructive" class="mb-3">
      <Alert.Title>Events refresh warning</Alert.Title>
      <Alert.Description>{error}</Alert.Description>
    </Alert.Root>
  {/if}
  <DataTable
    data={rows}
    columns={columns}
    filterColumnId="reason"
    filterPlaceholder="Filter events..."
  />
{/if}
