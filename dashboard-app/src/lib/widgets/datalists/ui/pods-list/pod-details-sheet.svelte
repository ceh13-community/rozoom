<script lang="ts">
  import Activity from "@lucide/svelte/icons/activity";
  import FileDown from "@lucide/svelte/icons/file-down";
  import Info from "@lucide/svelte/icons/info";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Terminal from "@lucide/svelte/icons/terminal";
  import Plug from "@lucide/svelte/icons/plug";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Copy from "@lucide/svelte/icons/copy";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Search from "@lucide/svelte/icons/search";
  import Bug from "@lucide/svelte/icons/bug";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import UserX from "@lucide/svelte/icons/user-x";
  import Trash from "@lucide/svelte/icons/trash";
  import type { Writable } from "svelte/store";
  import { tick } from "svelte";
  import { loadPodEvents, type PodEvent } from "$features/pod-details";
  import type { PodItem } from "$shared/model/clusters";
  import { getStringPodStatus } from "$entities/pod";
  import { getTimeDifference } from "$shared/lib/timeFormatters";
  import { buildKubectlDescribeCommand } from "../common/kubectl-command-builder";
  import DetailsSheetHeader from "../common/details-sheet-header.svelte";
  import DetailsMetadataGrid from "../common/details-metadata-grid.svelte";
  import ResourceTrafficChain from "../common/resource-traffic-chain.svelte";
  import ResourceMetricsBadge from "../common/resource-metrics-badge.svelte";
  import DetailsEventsList from "../common/details-events-list.svelte";
  import DetailsExplainState from "../common/details-explain-state.svelte";
  import DetailsSheetPortal from "$shared/ui/details-sheet-portal.svelte";

  interface PodDetailsSheetProps {
    data: Writable<Partial<PodItem> | null>;
    isOpen: Writable<boolean>;
    clusterId: string;
    metricsByKey: Map<string, { cpu: string; memory: string }>;
    metricsError: string | null;
    runtimeProfileLabel: string | null;
    runtimeSourceState: "live" | "cached" | "stale" | "paused" | "error" | "idle";
    runtimeLastUpdatedLabel: string | null;
    runtimeDetail: string | null;
    runtimeReason: string | null;
    runtimeRequestPath: string | null;
    runtimeSyncError?: string | null;
    onShell: (pod: Partial<PodItem>) => void;
    onAttach: (pod: Partial<PodItem>) => void;
    onLogs: (pod: Partial<PodItem>) => void;
    onPreviousLogs: (pod: Partial<PodItem>) => void;
    onEditYaml: (pod: Partial<PodItem>) => void;
    onInvestigate: (pod: Partial<PodItem>) => void;
    onCopyDescribe: (pod: Partial<PodItem>) => void;
    onRunDebugDescribe: (pod: Partial<PodItem>) => void;
    onCopyDebug: (pod: Partial<PodItem>) => void;
    onEvents?: (pod: Partial<PodItem>) => void;
    onDownloadYaml?: (pod: Partial<PodItem>) => void;
    onExportIncident?: (pod: Partial<PodItem>) => void;
    onEvict: (pod: Partial<PodItem>) => void;
    onDelete: (pod: Partial<PodItem>) => void;
  }

  const {
    data,
    isOpen,
    clusterId,
    metricsByKey,
    metricsError,
    runtimeProfileLabel,
    runtimeSourceState,
    runtimeLastUpdatedLabel,
    runtimeDetail,
    runtimeReason,
    runtimeRequestPath,
    runtimeSyncError = null,
    onShell,
    onAttach,
    onLogs,
    onPreviousLogs,
    onEditYaml,
    onInvestigate,
    onCopyDescribe,
    onRunDebugDescribe,
    onCopyDebug,
    onEvents,
    onDownloadYaml,
    onExportIncident,
    onEvict,
    onDelete,
  }: PodDetailsSheetProps = $props();

  let podEvents = $state<PodEvent[]>([]);
  let eventsLoading = $state(false);
  let eventsError = $state<string | null>(null);
  let eventsRequestId = 0;

  type PodStatusLike = Partial<PodItem["status"]> & {
    podIP?: string;
    podIPs?: Array<{ ip?: string }>;
  };

  type PodSpecLike = Partial<PodItem["spec"]> & {
    serviceAccountName?: string;
  };

  type PodMetadataLike = Partial<PodItem["metadata"]> & {
    annotations?: Record<string, string>;
    ownerReferences?: Array<{ kind?: string; name?: string; controller?: boolean }>;
  };

  function closeDetails() {
    isOpen.set(false);
  }

  async function runAction(action: (pod: Partial<PodItem>) => void) {
    if (!$data) return;
    isOpen.set(false);
    await tick();
    action($data);
  }

  function getCreatedLabel() {
    const createdAt = $data?.metadata?.creationTimestamp;
    if (!createdAt) return "-";
    const value = new Date(createdAt);
    if (Number.isNaN(value.getTime())) return "-";
    return `${getTimeDifference(value)} (${value.toLocaleString()})`;
  }

  function getControlledBy() {
    const metadata = ($data?.metadata as PodMetadataLike | undefined) ?? undefined;
    const owner =
      metadata?.ownerReferences?.find((reference) => (reference as { controller?: boolean }).controller) ??
      metadata?.ownerReferences?.[0];
    if (!owner?.kind || !owner.name) return "-";
    return `${owner.kind} ${owner.name}`;
  }

  function getPodIpList() {
    const status = ($data?.status as PodStatusLike | undefined) ?? undefined;
    const ips =
      status?.podIPs?.map((entry: { ip?: string }) => entry.ip).filter((value): value is string => Boolean(value)) ??
      [];
    if (ips.length > 0) return ips;
    const primary = status?.podIP;
    return primary ? [primary] : [];
  }

  function getContainerRows() {
    const specContainers = $data?.spec?.containers ?? [];
    const statusByName = new Map(
      ($data?.status?.containerStatuses ?? []).map((status) => [status.name, status] as const),
    );
    return specContainers.map((container) => {
      const status = statusByName.get(container.name);
      return {
        name: container.name,
        image: container.image ?? "-",
        ready: status?.ready ? "Ready" : "Not ready",
        restarts: status?.restartCount ?? 0,
      };
    });
  }

  function getMetrics() {
    const name = $data?.metadata?.name;
    if (!name) return null;
    const namespace = $data?.metadata?.namespace ?? "default";
    return metricsByKey.get(`${namespace}/${name}`) ?? null;
  }

  function getDescribeCommand() {
    const name = $data?.metadata?.name;
    if (!name) return null;
    return buildKubectlDescribeCommand({
      resource: "pod",
      name,
      namespace: $data?.metadata?.namespace,
    });
  }

  $effect(() => {
    const selected = $data;
    const open = $isOpen;
    if (!open || !selected?.metadata?.name || !selected?.metadata?.namespace || !clusterId) {
      podEvents = [];
      eventsLoading = false;
      eventsError = null;
      return;
    }
    void refreshPodEvents(selected);
  });

  async function refreshPodEvents(pod: Partial<PodItem>) {
    const currentRequest = ++eventsRequestId;
    eventsLoading = true;
    eventsError = null;
    try {
      const result = await loadPodEvents(clusterId, pod);
      if (currentRequest !== eventsRequestId) return;
      podEvents = result;
      eventsLoading = false;
    } catch (error) {
      if (currentRequest !== eventsRequestId) return;
      eventsError = error instanceof Error ? error.message : "Failed to load pod events.";
      podEvents = [];
      eventsLoading = false;
    }
  }
</script>

{#if $isOpen && $data}
<DetailsSheetPortal open={$isOpen} onClose={closeDetails} closeAriaLabel="Close pod details">
      <DetailsSheetHeader
        title="Pod"
        name={$data.metadata?.name ?? "-"}
        icon={Info}
        onClose={closeDetails}
        closeAriaLabel="Close pod details"
        actions={[
          {
            id: "shell",
            title: "Shell",
            ariaLabel: "Open pod shell",
            icon: Terminal,
            onClick: () => {
              void runAction(onShell);
            },
          },
          {
            id: "attach",
            title: "Attach pod",
            ariaLabel: "Attach to pod",
            icon: Plug,
            onClick: () => {
              void runAction(onAttach);
            },
          },
          {
            id: "logs",
            title: "Logs",
            ariaLabel: "Open pod logs",
            icon: ScrollText,
            onClick: () => {
              void runAction(onLogs);
            },
          },
          {
            id: "previous-logs",
            title: "Previous logs",
            ariaLabel: "Open previous pod logs",
            icon: RotateCcw,
            onClick: () => {
              void runAction(onPreviousLogs);
            },
          },
          ...(onEvents
            ? [
                {
                  id: "events",
                  title: "Events",
                  ariaLabel: "Open pod events",
                  icon: Activity,
                  onClick: () => {
                    void runAction(onEvents);
                  },
                },
              ]
            : []),
          {
            id: "yaml",
            title: "Edit YAML",
            ariaLabel: "Edit pod YAML",
            icon: Pencil,
            onClick: () => {
              void runAction(onEditYaml);
            },
          },
          {
            id: "investigate",
            title: "Investigate",
            ariaLabel: "Investigate pod",
            icon: Search,
            onClick: () => {
              void runAction(onInvestigate);
            },
          },
          {
            id: "describe",
            title: "Copy kubectl describe",
            ariaLabel: "Copy kubectl describe",
            icon: ClipboardList,
            onClick: () => {
              void runAction(onCopyDescribe);
            },
          },
          {
            id: "debug-describe",
            title: "Run debug describe",
            ariaLabel: "Run debug describe",
            icon: Bug,
            onClick: () => {
              void runAction(onRunDebugDescribe);
            },
          },
          {
            id: "debug",
            title: "Copy kubectl debug",
            ariaLabel: "Copy kubectl debug",
            icon: Copy,
            onClick: () => {
              void runAction(onCopyDebug);
            },
          },
          ...(onDownloadYaml
            ? [
                {
                  id: "download-yaml",
                  title: "Download YAML",
                  ariaLabel: "Download pod YAML",
                  icon: FileDown,
                  onClick: () => {
                    void runAction(onDownloadYaml);
                  },
                },
              ]
            : []),
          ...(onExportIncident
            ? [
                {
                  id: "export-incident",
                  title: "Export incident",
                  ariaLabel: "Export pod incident report",
                  icon: TriangleAlert,
                  onClick: () => {
                    void runAction(onExportIncident);
                  },
                },
              ]
            : []),
          {
            id: "evict",
            title: "Evict pod",
            ariaLabel: "Evict pod",
            icon: UserX,
            onClick: () => {
              void runAction(onEvict);
            },
          },
          {
            id: "delete",
            title: "Delete pod",
            ariaLabel: "Delete pod",
            icon: Trash,
            destructive: true,
            onClick: () => {
              void runAction(onDelete);
            },
          },
        ]}
      />

      <div class="flex-1 overflow-y-auto p-4">
        {#if $data.metadata?.name}
          <ResourceMetricsBadge {clusterId} resourceRef={`${$data.metadata?.namespace ?? "default"}/${$data.metadata.name}`} resourceType="pod" />
        {/if}
        <ResourceTrafficChain
          {clusterId}
          resourceKind="Pod"
          resourceName={$data.metadata?.name ?? ""}
          resourceNamespace={$data.metadata?.namespace ?? "default"}
          raw={$data as unknown as Record<string, unknown>}
        />
        <h3 class="mt-4 mb-2 flex items-center gap-2 font-bold">
          <Info class="h-4 w-4 text-muted-foreground" />
          Properties
        </h3>
        <DetailsMetadataGrid
          contextKey={`${$data.metadata?.namespace ?? "default"}/${$data.metadata?.name ?? "-"}`}
          fields={[
            { label: "Namespace", value: $data.metadata?.namespace ?? "default" },
            { label: "Status", value: getStringPodStatus($data as PodItem) },
            { label: "Node", value: $data.spec?.nodeName ?? "-" },
            { label: "Created", value: getCreatedLabel() },
            { label: "Controlled By", value: getControlledBy() },
            { label: "Service Account", value: ($data.spec as PodSpecLike | undefined)?.serviceAccountName ?? "-" },
            { label: "Pod IPs", lines: getPodIpList(), colSpan: 2 },
          ]}
          labels={Object.entries($data.metadata?.labels ?? {})}
          annotations={Object.entries((($data.metadata as PodMetadataLike | undefined)?.annotations ?? {}) as Record<string, string>)}
        />

        {#if metricsError}
          <div class="mt-3 rounded border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
            {metricsError}
          </div>
        {/if}

        <DetailsExplainState
          sourceState={runtimeSourceState}
          profileLabel={runtimeProfileLabel}
          lastUpdatedLabel={runtimeLastUpdatedLabel}
          detail={runtimeDetail}
          reason={runtimeReason}
          requestPath={runtimeRequestPath}
          describeCommand={getDescribeCommand()}
          syncError={runtimeSyncError}
        />

        <h3 class="my-4 font-bold">Containers</h3>
        {#if getContainerRows().length === 0}
          <div class="rounded border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
            No containers found.
          </div>
        {:else}
          <div class="overflow-hidden rounded border border-border">
            <div class="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] gap-3 border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <div>Name</div>
              <div>Image</div>
              <div>Ready</div>
              <div>Restarts</div>
            </div>
            {#each getContainerRows() as container}
              <div class="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0">
                <div class="min-w-0 truncate font-medium text-foreground">{container.name}</div>
                <div class="min-w-0 truncate text-muted-foreground">{container.image}</div>
                <div class="min-w-0 truncate text-muted-foreground">{container.ready}</div>
                <div class="min-w-0 truncate text-muted-foreground">{container.restarts}</div>
              </div>
            {/each}
          </div>
        {/if}

        <h3 class="my-4 font-bold">Events</h3>
        <DetailsEventsList
          events={podEvents}
          loading={eventsLoading}
          error={eventsError}
          emptyText="No events found."
        />
      </div>
</DetailsSheetPortal>
{/if}
