<script lang="ts">
  import * as Alert from "$shared/ui/alert";
  import DataTable from "./workloads-table.svelte";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import type { ColumnDef } from "@tanstack/table-core";
  import type { CertificateRow, RotationRow } from "./model/overview-runtime";

  interface Props {
    certificatesRows: CertificateRow[];
    rotationRows: RotationRow[];
    loading: boolean;
    error: string | null;
    certificateColumns: ColumnDef<CertificateRow>[];
    rotationColumns: ColumnDef<RotationRow>[];
    controlPlaneDetected?: boolean;
  }

  const {
    certificatesRows,
    rotationRows,
    loading,
    error,
    certificateColumns,
    rotationColumns,
    controlPlaneDetected,
  }: Props = $props();

  // When every rotation row says "unknown" on a managed cluster, the
  // table is noise - RKE2/EKS/GKE manage kubelet certs outside the
  // standard Kubernetes CSR flow so we have no way to observe them.
  // Replace the table with a single explainer instead of N rows of
  // "Unknown / Unknown / unknown / -".
  const allRotationUnknown = $derived(
    rotationRows.length > 0 && rotationRows.every((row) => row.status === "unknown"),
  );
  const hideRotationTable = $derived(allRotationUnknown && controlPlaneDetected === false);
</script>

{#if loading && certificatesRows.length === 0 && rotationRows.length === 0}
  <div class="text-sm text-muted-foreground inline-flex items-center gap-1">
    Loading certificates<LoadingDots />
  </div>
{:else}
  {#if loading}
    <div class="mb-2 text-xs text-muted-foreground inline-flex items-center gap-1">
      Updating certificates<LoadingDots />
    </div>
  {/if}
  {#if controlPlaneDetected === false}
    <div
      class="mb-3 rounded border border-sky-300/40 bg-sky-50/80 dark:border-sky-700/40 dark:bg-sky-950/30 px-3 py-1.5 text-[11px] text-sky-800 dark:text-sky-200"
      role="status"
    >
      <span class="font-semibold">Managed control plane</span> — no kubeadm static pod found in
      <code class="text-xs">kube-system</code>. Control-plane certificate rotation is owned by your
      provider (RKE2, EKS, GKE, AKS, …). The table below shows application-level TLS Secrets and
      cert-manager Certificates.
    </div>
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
    <div class="text-sm text-muted-foreground">
      No certificates found. The view aggregates kubeadm control-plane certs, TLS Secrets (<code
        class="text-xs">type: kubernetes.io/tls</code
      >), and cert-manager <code class="text-xs">Certificate</code> resources.
    </div>
  {/if}
  <h4 class="mt-6 text-sm font-semibold">Kubelet rotation</h4>
  {#if hideRotationTable}
    <div
      class="mt-2 rounded border border-sky-300/40 bg-sky-50/80 dark:border-sky-700/40 dark:bg-sky-950/30 px-3 py-2 text-[11px] text-sky-800 dark:text-sky-200"
    >
      Kubelet rotation status isn't observable from this cluster. Rancher/RKE2, EKS, GKE, and AKS
      rotate kubelet certificates outside the standard Kubernetes CSR flow — there's nothing for
      ROZOOM to read. Trust the provider's rotation policy or inspect kubelet config directly on
      each node. Detected {rotationRows.length} node{rotationRows.length === 1 ? "" : "s"}.
    </div>
  {:else if rotationRows.length}
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
      {controlPlaneDetected === false
        ? "Kubelet rotation check relies on kubeadm-style node access; not applicable on managed clusters."
        : "No kubelet rotation data returned."}
    </div>
  {/if}
{/if}
