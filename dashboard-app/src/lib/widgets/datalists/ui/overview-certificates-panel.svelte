<script lang="ts">
  import * as Alert from "$shared/ui/alert";
  import DataTable from "./workloads-table.svelte";
  import type { ColumnDef } from "@tanstack/table-core";

  type CertificateRow = {
    uid: string;
    name: string;
    expiresIn: string;
    expiresOn: string;
    status: string;
  };

  type RotationRow = {
    uid: string;
    node: string;
    rotateClient: string;
    rotateServer: string;
    status: string;
    message: string;
  };

  interface Props {
    certificatesRows: CertificateRow[];
    rotationRows: RotationRow[];
    loading: boolean;
    error: string | null;
    certificateColumns: ColumnDef<CertificateRow>[];
    rotationColumns: ColumnDef<RotationRow>[];
  }

  const { certificatesRows, rotationRows, loading, error, certificateColumns, rotationColumns }: Props =
    $props();
</script>

{#if loading && certificatesRows.length === 0 && rotationRows.length === 0}
  <div class="text-sm text-muted-foreground">Loading certificates…</div>
{:else}
  {#if loading}
    <div class="mb-2 text-xs text-muted-foreground">Updating certificates…</div>
  {/if}
  {#if error}
    <Alert.Root>
      <Alert.Title>Certificates partially unavailable</Alert.Title>
      <Alert.Description>{error}</Alert.Description>
    </Alert.Root>
  {/if}
  {#if certificatesRows.length}
    <DataTable
      data={certificatesRows}
      columns={certificateColumns}
      filterColumnId="name"
      filterPlaceholder="Filter certificates..."
    />
  {:else}
    <div class="text-sm text-muted-foreground">No certificate data returned.</div>
  {/if}
  <h4 class="mt-6 text-sm font-semibold">Kubelet rotation</h4>
  {#if rotationRows.length}
    <div class="mt-2">
      <DataTable
        data={rotationRows}
        columns={rotationColumns}
        filterColumnId="node"
        filterPlaceholder="Filter nodes..."
      />
    </div>
  {:else}
    <div class="mt-2 text-sm text-muted-foreground">
      No kubelet rotation data returned.
    </div>
  {/if}
{/if}
