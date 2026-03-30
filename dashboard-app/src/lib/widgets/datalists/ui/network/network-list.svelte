<script lang="ts">
  import ActionNotificationBar from "$shared/ui/action-notification-bar.svelte";
  import { invalidateAll } from "$app/navigation";
  import { resolvePageClusterName, type PageData } from "$entities/cluster";
  import { runDebugDescribe } from "$features/resource-debug-runtime";
  import { confirmAction } from "$shared/lib/confirm-action";
  import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
  import {
    dashboardDataProfile,
    getDashboardDataProfileDisplayName,
  } from "$shared/lib/dashboard-data-profile.svelte";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";
  import TableSummaryFilterBar from "$shared/ui/table-summary-filter-bar.svelte";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import type {
    SectionDetailsBoundaryState,
    SectionWorkbenchBoundaryState,
  } from "$features/section-runtime";
  import { buildSectionSummaryItems } from "$features/section-runtime";
  import {
    buildKubectlDescribeCommand,
    buildKubectlGetYamlCommand,
  } from "../common/kubectl-command-builder";
  import { selectedNamespace } from "$features/namespace-management";
  import { Button } from "$shared/ui/button";
  import ResourceActionsMenu from "../common/resource-actions-menu.svelte";
  import NetworkBulkActions from "./network-bulk-actions.svelte";
  import ResourceSelectionCheckbox from "../common/resource-selection-checkbox.svelte";
  import SectionRuntimeStatus from "../common/section-runtime-status.svelte";
  import WorkloadSelectionBar from "../common/workload-selection-bar.svelte";
  import NetworkDetailsSheet from "./network-details-sheet.svelte";
  import NetworkWorkbenchPanel, {
    type NetworkWorkbenchOpenRequest,
  } from "./network-workbench-panel.svelte";
  import {
    createNetworkListRows,
    filterNetworkListRows,
    type NetworkListRow,
  } from "./model/network-list-row";

  type GenericItem = Record<string, unknown>;
  type NetworkWorkloadKey = "services" | "endpoints";

  interface Props {
    data: PageData & {
      items?: GenericItem[];
      workloadKey?: NetworkWorkloadKey | null;
    };
  }

  const TITLE_BY_WORKLOAD: Record<NetworkWorkloadKey, string> = {
    services: "Services",
    endpoints: "Endpoints",
  };

  let { data }: Props = $props();
  let query = $state("");
  let selectedIds = $state(new Set<string>());
  let deletingIds = $state(new Set<string>());
  let selectedRow = $state<NetworkListRow | null>(null);
  let detailsOpen = $state(false);
  import {
    notifySuccess,
    notifyError,
    type ActionNotification,
  } from "$shared/lib/action-notification";
  let actionNotification = $state<ActionNotification>(null);

  let runtimeRefreshInFlight = $state(false);
  let workbenchRequest = $state<NetworkWorkbenchOpenRequest>(null);
  let workbenchRequestToken = 0;

  const workloadKey = $derived((data.workloadKey ?? "services") as NetworkWorkloadKey);
  const title = $derived(TITLE_BY_WORKLOAD[workloadKey] ?? "Network");
  const sourceItems = $derived((Array.isArray(data.items) ? data.items : []) as GenericItem[]);
  const rows = $derived.by(() => createNetworkListRows(sourceItems, workloadKey));
  const filteredRows = $derived.by(() => filterNetworkListRows(rows, query));
  const rowsByUid = $derived.by(() => {
    const next = new Map<string, GenericItem>();
    for (const item of sourceItems) {
      const row = createNetworkListRows([item], workloadKey)[0];
      if (row) next.set(row.uid, item);
    }
    return next;
  });
  const availableIds = $derived.by(() => filteredRows.map((row) => row.uid));
  const selectedRows = $derived.by(() => filteredRows.filter((row) => selectedIds.has(row.uid)));
  const bulkMode = $derived((selectedRows.length === 1 ? "single" : "multi") as "single" | "multi");
  const areAllSelected = $derived(
    availableIds.length > 0 && availableIds.every((id) => selectedIds.has(id)),
  );
  const detailsBoundary = $derived.by(
    (): SectionDetailsBoundaryState<NetworkListRow> => ({
      selectedRow,
      isOpen: detailsOpen,
    }),
  );
  const workbenchBoundary = $derived.by(
    (): SectionWorkbenchBoundaryState<NetworkWorkbenchOpenRequest> => ({
      request: workbenchRequest,
      token: workbenchRequestToken,
    }),
  );
  const summaryItems = $derived.by(() =>
    buildSectionSummaryItems({
      cluster: resolvePageClusterName(data),
      selectedNamespace: $selectedNamespace,
      rows: filteredRows.length,
    }),
  );

  const RESOURCE_BY_WORKLOAD: Record<
    NetworkWorkloadKey,
    { resource: string; namespaceScoped: boolean }
  > = {
    services: { resource: "service", namespaceScoped: true },
    endpoints: { resource: "endpoints", namespaceScoped: true },
  };
  const canOpenWeb = $derived(workloadKey === "services");
  const runtimeProfileLabel = $derived(
    `${getDashboardDataProfileDisplayName($dashboardDataProfile)} profile`,
  );
  const runtimeDetail = $derived("Network inventory is route-scoped and refreshed on demand.");
  const runtimeReason = $derived(
    `Namespace scope: ${$selectedNamespace || "all namespaces"}. Background watchers are intentionally disabled.`,
  );

  function pruneSelection() {
    const next = new Set([...selectedIds].filter((id) => availableIds.includes(id)));
    const changed = next.size !== selectedIds.size || [...next].some((id) => !selectedIds.has(id));
    if (!changed) return;
    selectedIds = next;
  }

  function toggleSelection(id: string, next: boolean) {
    const updated = new Set(selectedIds);
    if (next) updated.add(id);
    else updated.delete(id);
    selectedIds = updated;
  }

  function toggleAll(next: boolean) {
    selectedIds = next ? new Set(availableIds) : new Set();
  }

  function openDetails(row: NetworkListRow) {
    selectedRow = row;
    detailsOpen = true;
  }

  function openServiceWorkbench(row: NetworkListRow) {
    if (!canOpenWeb) return;
    workbenchRequestToken += 1;
    workbenchRequest = {
      token: workbenchRequestToken,
      kind: "service-port-forward",
      rowUid: row.uid,
    };
  }

  function getTarget(row: NetworkListRow) {
    const descriptor = RESOURCE_BY_WORKLOAD[workloadKey];
    return {
      resource: descriptor.resource,
      name: row.name,
      namespace: descriptor.namespaceScoped ? row.namespace : undefined,
      namespaceScoped: descriptor.namespaceScoped,
    };
  }

  async function copyText(value: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(value);
  }

  async function copyGetYaml(row: NetworkListRow) {
    await copyText(buildKubectlGetYamlCommand(getTarget(row)));
    actionNotification = notifySuccess(`Copied kubectl get -o yaml for ${row.name}.`);
  }

  async function copyDescribe(row: NetworkListRow) {
    await copyText(buildKubectlDescribeCommand(getTarget(row)));
    actionNotification = notifySuccess(`Copied kubectl describe for ${row.name}.`);
  }

  function openDebugDescribe(row: NetworkListRow) {
    const target = getTarget(row);
    runDebugDescribe({
      clusterId: data.slug,
      resource: target.resource,
      name: target.name,
      namespace: target.namespace,
      title: `Describe ${row.subtype.toLowerCase()} ${row.namespace}/${row.name}`,
    });
    actionNotification = notifySuccess(`Opened debug describe for ${row.name}.`);
  }

  function setDeleting(id: string, next: boolean) {
    const updated = new Set(deletingIds);
    if (next) updated.add(id);
    else updated.delete(id);
    deletingIds = updated;
  }

  async function deleteRows(rowsToDelete: NetworkListRow[]) {
    if (!data.slug || rowsToDelete.length === 0) return;
    const confirmed = await confirmAction(
      `Delete ${rowsToDelete.length} network resource(s)?`,
      "Confirm delete",
    );
    if (!confirmed) return;

    actionNotification = null;
    for (const row of rowsToDelete) {
      const target = getTarget(row);
      const args = ["delete", target.resource, row.name];
      if (target.namespaceScoped) {
        args.push("-n", row.namespace);
      }
      setDeleting(row.uid, true);
      try {
        const response = await kubectlRawArgsFront(args, { clusterId: data.slug });
        if (response.errors) {
          throw new Error(response.errors);
        }
      } catch (error) {
        actionNotification = notifyError(
          error instanceof Error ? error.message : "Failed to delete network resource.",
        );
        return;
      } finally {
        setDeleting(row.uid, false);
      }
    }

    actionNotification = notifySuccess(`Deleted ${rowsToDelete.length} network resource(s).`);
    selectedIds = new Set();
    detailsOpen = false;
  }

  async function refreshRuntimeSection() {
    if (runtimeRefreshInFlight) return;
    runtimeRefreshInFlight = true;
    actionNotification = null;
    try {
      await invalidateAll();
      actionNotification = notifySuccess(`${title} refreshed.`);
    } catch (error) {
      actionNotification = notifyError(
        error instanceof Error ? error.message : `Failed to refresh ${title}.`,
      );
    } finally {
      runtimeRefreshInFlight = false;
    }
  }

  $effect(() => {
    pruneSelection();
  });
</script>

<div class="grid gap-4">
  <ActionNotificationBar
    notification={actionNotification}
    onDismiss={() => {
      actionNotification = null;
    }}
  />

  <TableSummaryFilterBar
    items={summaryItems}
    value={query}
    placeholder="Filter by name, namespace, kind, summary, or ports"
    onInput={(value) => {
      query = value;
    }}
  />

  <SectionRuntimeStatus
    sectionLabel="Network Runtime Status"
    profileLabel={runtimeProfileLabel}
    sourceState={filteredRows.length > 0 ? "cached" : "idle"}
    mode="on-demand"
    budgetSummary="route scoped"
    detail={runtimeDetail}
    secondaryActionLabel="Update"
    secondaryActionAriaLabel="Refresh network runtime section"
    secondaryActionLoading={runtimeRefreshInFlight}
    onSecondaryAction={() => void refreshRuntimeSection()}
    reason={runtimeReason}
  />

  {#if selectedRows.length > 0}
    <WorkloadSelectionBar count={selectedRows.length}>
      {#snippet children()}
        <NetworkBulkActions
          mode={bulkMode}
          disabled={selectedRows.length === 0}
          showOpenWeb={canOpenWeb}
          onShowDetails={() => {
            const row = selectedRows[0];
            if (!row) return;
            openDetails(row);
          }}
          onOpenWeb={() => {
            const row = selectedRows[0];
            if (!row) return;
            openServiceWorkbench(row);
          }}
          onCopyKubectlGetYaml={() => {
            const row = selectedRows[0];
            if (!row) return;
            void copyGetYaml(row);
          }}
          onCopyKubectlDescribe={() => {
            const row = selectedRows[0];
            if (!row) return;
            void copyDescribe(row);
          }}
          onRunDebugDescribe={() => {
            const row = selectedRows[0];
            if (!row) return;
            openDebugDescribe(row);
          }}
          onDelete={() => {
            void deleteRows(selectedRows);
          }}
        />
        <Button
          variant="outline"
          size="sm"
          onclick={() => {
            selectedIds = new Set();
          }}>Clear</Button
        >
      {/snippet}
    </WorkloadSelectionBar>
  {/if}

  <TableSurface>
    {#snippet children()}
      <div
        class="sticky-table-header grid grid-cols-[auto_auto_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,2fr)_minmax(0,0.7fr)_minmax(0,0.7fr)] gap-3 border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        <div>
          <ResourceSelectionCheckbox
            checked={areAllSelected}
            label="Select all network resources"
            onToggle={toggleAll}
          />
        </div>
        <div>Actions</div>
        <div>Name</div>
        <div>Namespace</div>
        <div>Kind</div>
        <div>Summary</div>
        <div>Ports</div>
        <div>Age</div>
      </div>

      {#if filteredRows.length === 0}
        <TableEmptyState message="No results for the current filter." />
      {:else}
        {#each filteredRows as row (row.uid)}
          <div
            class={`grid grid-cols-[auto_auto_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,2fr)_minmax(0,0.7fr)_minmax(0,0.7fr)] gap-3 border-b border-border/60 px-4 py-3 text-sm transition-colors ${selectedIds.has(row.uid) ? "bg-muted/30" : "hover:bg-muted/20"}`}
            role="button"
            tabindex="0"
            onclick={() => openDetails(row)}
            onkeydown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openDetails(row);
              }
            }}
          >
            <div class="flex items-center">
              <ResourceSelectionCheckbox
                checked={selectedIds.has(row.uid)}
                label={`Select network resource ${row.name}`}
                stopPropagation={true}
                onToggle={(next) => toggleSelection(row.uid, next)}
              />
            </div>
            <div class="flex items-center">
              <ResourceActionsMenu
                name={row.name}
                namespace={row.namespace}
                isBusy={deletingIds.has(row.uid)}
                onShowDetails={() => openDetails(row)}
                onOpenWeb={canOpenWeb
                  ? () => {
                      openServiceWorkbench(row);
                    }
                  : undefined}
                onCopyKubectlGetYaml={() => {
                  void copyGetYaml(row);
                }}
                onCopyKubectlDescribe={() => {
                  void copyDescribe(row);
                }}
                onRunDebugDescribe={() => {
                  openDebugDescribe(row);
                }}
                onDelete={() => {
                  void deleteRows([row]);
                }}
              />
            </div>
            <div class="min-w-0 truncate font-medium text-foreground">{row.name}</div>
            <div class="min-w-0 truncate text-muted-foreground">{row.namespace}</div>
            <div class="min-w-0 truncate text-muted-foreground">{row.subtype}</div>
            <div class="min-w-0 truncate text-muted-foreground">{row.summary}</div>
            <div class="min-w-0 truncate text-muted-foreground">{row.ports}</div>
            <div class="min-w-0 truncate text-muted-foreground">{row.age}</div>
          </div>
        {/each}
      {/if}
    {/snippet}
  </TableSurface>

  <NetworkDetailsSheet
    clusterId={data.slug}
    row={detailsBoundary.selectedRow}
    isOpen={detailsBoundary.isOpen}
    showOpenWeb={canOpenWeb}
    onClose={() => {
      detailsOpen = false;
    }}
    onOpenWeb={(row) => {
      detailsOpen = false;
      openServiceWorkbench(row);
    }}
    onCopyKubectlGetYaml={(row) => {
      void copyGetYaml(row);
    }}
    onCopyKubectlDescribe={(row) => {
      void copyDescribe(row);
    }}
    onRunDebugDescribe={(row) => {
      openDebugDescribe(row);
    }}
    onDelete={(row) => {
      void deleteRows([row]);
    }}
  />

  <NetworkWorkbenchPanel
    clusterId={data.slug}
    {rowsByUid}
    request={workbenchBoundary.request}
    onMessage={(message) => {
      actionNotification = notifySuccess(message);
    }}
    onError={(message) => {
      actionNotification = notifyError(message);
    }}
  />
</div>
