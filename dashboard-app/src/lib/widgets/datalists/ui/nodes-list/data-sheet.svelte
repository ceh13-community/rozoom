<script lang="ts">
  import { tick } from "svelte";
  import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
  import { timeAgo } from "$shared/lib/timeFormatters";
  import type { NodeItem, PodItem } from "$shared/model/clusters";
  import Activity from "@lucide/svelte/icons/activity";
  import Bug from "@lucide/svelte/icons/bug";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Clock3 from "@lucide/svelte/icons/clock-3";
  import Database from "@lucide/svelte/icons/database";
  import FileDown from "@lucide/svelte/icons/file-down";
  import Info from "@lucide/svelte/icons/info";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plug from "@lucide/svelte/icons/plug";
  import Search from "@lucide/svelte/icons/search";
  import Server from "@lucide/svelte/icons/server";
  import Terminal from "@lucide/svelte/icons/terminal";
  import Trash from "@lucide/svelte/icons/trash";
  import UserX from "@lucide/svelte/icons/user-x";
  import type { Writable } from "svelte/store";
  import DetailsMetadataGrid from "../common/details-metadata-grid.svelte";
  import DetailsEventsList from "../common/details-events-list.svelte";
  import DetailsHeaderActions from "../common/details-header-actions.svelte";
  import ResourceMetricsBadge from "../common/resource-metrics-badge.svelte";
  import { loadNodeEvents, type NodeEvent } from "./node-events";
  import { loadNodeTop, type NodeTopMetrics } from "./node-top";
  import DetailsSheetPortal from "$shared/ui/details-sheet-portal.svelte";
  import ResourceTrafficChain from "../common/resource-traffic-chain.svelte";

  interface NodeSheetProps {
    clusterId: string;
    data: Writable<NodeItem | null>;
    isOpen: Writable<boolean>;
    focus: Writable<{ section: "top" | "events" | null; token: number }>;
    onShell: () => void;
    onEditYaml: () => void;
    onInvestigate?: () => void;
    onCopyDescribe?: () => void;
    onRunDebugDescribe?: () => void;
    onDownloadYaml?: () => void;
    onToggleCordon: () => void;
    onDrain: () => void;
    onDelete: () => void;
  }

  const { clusterId, data, isOpen, focus, onShell, onEditYaml, onInvestigate, onCopyDescribe, onRunDebugDescribe, onDownloadYaml, onToggleCordon, onDrain, onDelete }:
    NodeSheetProps = $props();

  type NodePodRow = {
    name: string;
    node: string;
    namespace: string;
    ready: string;
    status: string;
  };

  let pods = $state<NodePodRow[]>([]);
  let podsLoading = $state(false);
  let podsError = $state<string | null>(null);
  let podRequestId = 0;
  let events = $state<NodeEvent[]>([]);
  let eventsLoading = $state(false);
  let eventsError = $state<string | null>(null);
  let eventsRequestId = 0;
  let topMetrics = $state<NodeTopMetrics | null>(null);
  let topLoading = $state(false);
  let topError = $state<string | null>(null);
  let topRequestId = 0;
  let topSectionElement = $state<HTMLElement | null>(null);
  let eventsSectionElement = $state<HTMLElement | null>(null);

  function closeDetails() {
    isOpen.set(false);
  }

  function runAction(callback: () => void) {
    closeDetails();
    callback();
  }

  function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  function getMetadata() {
    return $data?.metadata ?? null;
  }

  function getStatus() {
    return asRecord($data?.status);
  }

  function getLabelEntries() {
    return Object.entries((getMetadata()?.labels ?? {}) as Record<string, string>);
  }

  function getAnnotationEntries() {
    const metadata = asRecord(getMetadata());
    return Object.entries((metadata.annotations ?? {}) as Record<string, string>);
  }

  function getCreatedLabel() {
    const raw = getMetadata()?.creationTimestamp;
    if (!raw) return "-";
    const at = new Date(raw);
    if (Number.isNaN(at.getTime())) return "-";
    return `${timeAgo(at)} (${at.toLocaleString()})`;
  }

  function getAddresses() {
    const addresses = getStatus().addresses;
    if (!Array.isArray(addresses)) return [];
    return addresses
      .map((item) => asRecord(item))
      .map((item) => ({
        type: typeof item.type === "string" ? item.type : "-",
        address: typeof item.address === "string" ? item.address : "-",
      }))
      .filter((item) => item.address !== "-");
  }

  function getNodeInfo() {
    const info = asRecord(getStatus().nodeInfo);
    return {
      os: `${typeof info.operatingSystem === "string" ? info.operatingSystem : "-"} (${typeof info.architecture === "string" ? info.architecture : "-"})`,
      osImage: typeof info.osImage === "string" ? info.osImage : "-",
      kernelVersion: typeof info.kernelVersion === "string" ? info.kernelVersion : "-",
      containerRuntime: typeof info.containerRuntimeVersion === "string" ? info.containerRuntimeVersion : "-",
      kubeletVersion: typeof info.kubeletVersion === "string" ? info.kubeletVersion : "-",
    };
  }

  function getReadyCondition() {
    const conditions = getStatus().conditions;
    if (!Array.isArray(conditions)) return "-";
    const ready = conditions.map((item) => asRecord(item)).find((item) => item.type === "Ready");
    if (!ready) return "-";
    return ready.status === "True" ? "Ready" : "Not ready";
  }

  function isReadyCondition() {
    return getReadyCondition() === "Ready";
  }

  function formatCpu(value: unknown) {
    if (typeof value !== "string" || !value) return "-";
    if (value.endsWith("m")) {
      const num = Number(value.slice(0, -1));
      if (Number.isFinite(num)) return `${(num / 1000).toFixed(2).replace(/\.00$/, "")}`;
    }
    return value;
  }

  function formatBytesQuantity(value: unknown) {
    if (typeof value !== "string" || !value) return "-";
    if (/^\d+$/.test(value)) {
      const bytes = Number(value);
      if (!Number.isFinite(bytes) || bytes <= 0) return value;
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1).replace(/\.0$/, "")}GiB`;
    }
    const match = /^([0-9.]+)(Ki|Mi|Gi|Ti)?$/.exec(value);
    if (!match) return value;
    const amount = Number(match[1]);
    const unit = match[2] ?? "";
    if (!Number.isFinite(amount)) return value;
    if (unit === "Gi") return `${amount.toFixed(1).replace(/\.0$/, "")}GiB`;
    if (unit === "Mi") return `${(amount / 1024).toFixed(1).replace(/\.0$/, "")}GiB`;
    if (unit === "Ki") return `${(amount / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")}GiB`;
    return value;
  }

  function getCapacity() {
    const capacity = asRecord(getStatus().capacity);
    const allocatable = asRecord(getStatus().allocatable);
    return {
      capacity: {
        cpu: formatCpu(capacity.cpu),
        memory: formatBytesQuantity(capacity.memory),
        disk: formatBytesQuantity(capacity["ephemeral-storage"]),
        pods: typeof capacity.pods === "string" ? capacity.pods : "-",
      },
      allocatable: {
        cpu: formatCpu(allocatable.cpu),
        memory: formatBytesQuantity(allocatable.memory),
        disk: formatBytesQuantity(allocatable["ephemeral-storage"]),
        pods: typeof allocatable.pods === "string" ? allocatable.pods : "-",
      },
    };
  }

  function mapPods(items: Partial<PodItem>[]) {
    return items.map((pod) => {
      const statuses = pod.status?.containerStatuses ?? [];
      const ready = statuses.filter((item) => item.ready).length;
      const total = statuses.length;
      return {
        name: pod.metadata?.name ?? "-",
        node: pod.spec?.nodeName ?? "-",
        namespace: pod.metadata?.namespace ?? "default",
        ready: total > 0 ? `${ready} / ${total}` : "-",
        status: pod.status?.phase ?? "-",
      } satisfies NodePodRow;
    });
  }

  function getPodStatusTone(status: string) {
    const normalized = status.toLowerCase();
    if (normalized === "running" || normalized === "succeeded") {
      return "border-emerald-300/60 bg-emerald-100/40 text-emerald-700 dark:text-emerald-300";
    }
    if (normalized === "pending") {
      return "border-amber-300/60 bg-amber-100/40 text-amber-700 dark:text-amber-300";
    }
    if (normalized === "failed" || normalized === "unknown") {
      return "border-rose-300/60 bg-rose-100/40 text-rose-700 dark:text-rose-300";
    }
    return "border-slate-300/60 bg-slate-100/40 text-slate-700 dark:text-slate-300";
  }

  function getReadyTone(ready: string) {
    const match = /^(\d+)\s*\/\s*(\d+)$/.exec(ready);
    if (!match) return "text-muted-foreground";
    const current = Number(match[1]);
    const total = Number(match[2]);
    if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
      return "text-muted-foreground";
    }
    return current === total
      ? "text-emerald-700 dark:text-emerald-300"
      : "text-amber-700 dark:text-amber-300";
  }

  async function loadNodePods(nodeName: string) {
    const currentRequest = ++podRequestId;
    podsLoading = true;
    podsError = null;
    try {
      const response = await kubectlRawArgsFront(
        ["get", "pods", "--all-namespaces", "--field-selector", `spec.nodeName=${nodeName}`, "-o", "json"],
        { clusterId },
      );
      if (currentRequest !== podRequestId) return;
      if (response.errors || response.code !== 0) {
        throw new Error(response.errors || `Failed to load pods for node ${nodeName}.`);
      }
      const parsed = JSON.parse(response.output || "{}") as { items?: Partial<PodItem>[] };
      pods = mapPods(parsed.items ?? []);
    } catch (error) {
      if (currentRequest !== podRequestId) return;
      podsError = error instanceof Error ? error.message : "Failed to load node pods.";
      pods = [];
    } finally {
      if (currentRequest !== podRequestId) return;
      podsLoading = false;
    }
  }

  async function loadNodeEventsSection(nodeName: string) {
    const currentRequest = ++eventsRequestId;
    eventsLoading = true;
    eventsError = null;
    try {
      const nextEvents = await loadNodeEvents(clusterId, nodeName);
      if (currentRequest !== eventsRequestId) return;
      events = nextEvents;
    } catch (error) {
      if (currentRequest !== eventsRequestId) return;
      eventsError = error instanceof Error ? error.message : "Failed to load node events.";
      events = [];
    } finally {
      if (currentRequest !== eventsRequestId) return;
      eventsLoading = false;
    }
  }

  async function loadNodeTopSection(nodeName: string) {
    const currentRequest = ++topRequestId;
    topLoading = true;
    topError = null;
    try {
      const nextTop = await loadNodeTop(clusterId, nodeName);
      if (currentRequest !== topRequestId) return;
      topMetrics = nextTop;
    } catch (error) {
      if (currentRequest !== topRequestId) return;
      topError = error instanceof Error ? error.message : "Failed to load node metrics.";
      topMetrics = null;
    } finally {
      if (currentRequest !== topRequestId) return;
      topLoading = false;
    }
  }

  $effect(() => {
    const nodeName = $data?.metadata?.name;
    if (!$isOpen || !nodeName || !clusterId) return;
    void loadNodePods(nodeName);
    void loadNodeEventsSection(nodeName);
    void loadNodeTopSection(nodeName);
  });

  $effect(() => {
    if (!$isOpen || !$focus.token || !$focus.section) return;
    const section = $focus.section;
    const target = section === "top" ? topSectionElement : eventsSectionElement;
    if (!target) return;
    void tick().then(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
</script>

{#if $isOpen && $data}
<DetailsSheetPortal open={$isOpen} onClose={closeDetails} closeAriaLabel="Close node details">
      <div class="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div class="min-w-0 flex items-center gap-2">
          <Info class="h-4 w-4 shrink-0 text-muted-foreground" />
          <div class="truncate text-base font-semibold">Node: {$data.metadata?.name ?? "-"}</div>
        </div>
        <DetailsHeaderActions
          actions={[
            {
              id: "top-node",
              title: "Top node",
              ariaLabel: "Open top node section",
              icon: Activity,
              onClick: () => {
                focus.set({ section: "top", token: $focus.token + 1 });
              },
            },
            {
              id: "events",
              title: "Events",
              ariaLabel: "Open node events section",
              icon: Clock3,
              onClick: () => {
                focus.set({ section: "events", token: $focus.token + 1 });
              },
            },
            {
              id: "shell",
              title: "Shell",
              ariaLabel: "Open node shell",
              icon: Terminal,
              onClick: () => {
                runAction(onShell);
              },
            },
            {
              id: "edit-yaml",
              title: "Edit YAML",
              ariaLabel: "Edit node YAML",
              icon: Pencil,
              onClick: () => {
                runAction(onEditYaml);
              },
            },
            ...(onInvestigate
              ? [
                  {
                    id: "investigate",
                    title: "Investigate",
                    ariaLabel: "Investigate node",
                    icon: Search,
                    onClick: () => {
                      runAction(onInvestigate);
                    },
                  },
                ]
              : []),
            ...(onCopyDescribe
              ? [
                  {
                    id: "copy-describe",
                    title: "Copy describe",
                    ariaLabel: "Copy kubectl describe for node",
                    icon: ClipboardList,
                    onClick: () => {
                      runAction(onCopyDescribe);
                    },
                  },
                ]
              : []),
            ...(onRunDebugDescribe
              ? [
                  {
                    id: "debug-describe",
                    title: "Debug describe",
                    ariaLabel: "Run debug describe for node",
                    icon: Bug,
                    onClick: () => {
                      runAction(onRunDebugDescribe);
                    },
                  },
                ]
              : []),
            ...(onDownloadYaml
              ? [
                  {
                    id: "download-yaml",
                    title: "Download YAML",
                    ariaLabel: "Download node YAML",
                    icon: FileDown,
                    onClick: () => {
                      runAction(onDownloadYaml);
                    },
                  },
                ]
              : []),
            {
              id: "toggle-cordon",
              title: $data.spec?.unschedulable ? "Uncordon" : "Cordon",
              ariaLabel: $data.spec?.unschedulable ? "Uncordon node" : "Cordon node",
              icon: UserX,
              onClick: () => {
                runAction(onToggleCordon);
              },
            },
            {
              id: "drain",
              title: "Drain",
              ariaLabel: "Drain node",
              icon: Plug,
              onClick: () => {
                runAction(onDrain);
              },
            },
            {
              id: "delete",
              title: "Delete",
              ariaLabel: "Delete node",
              icon: Trash,
              onClick: () => {
                runAction(onDelete);
              },
              destructive: true,
            },
          ]}
          onClose={closeDetails}
          closeAriaLabel="Close node details"
          closeTitle="Close"
        />
      </div>
      <div class="flex-1 overflow-y-auto p-4">
        {#if $data.metadata?.name}
          <ResourceMetricsBadge {clusterId} resourceRef={$data.metadata.name} resourceType="node" />
        {/if}
        <ResourceTrafficChain
          {clusterId}
          resourceKind="Node"
          resourceName={$data.metadata?.name ?? ""}
          resourceNamespace=""
          raw={$data as unknown as Record<string, unknown>}
        />
        <h3 class="mt-4 mb-2 flex items-center gap-2 font-bold">
          <Info class="h-4 w-4 text-muted-foreground" />
          Properties
        </h3>
        <DetailsMetadataGrid
          contextKey={`${$data.metadata?.name ?? "-"}`}
          fields={[
            { label: "Created", value: getCreatedLabel() },
            { label: "Name", value: $data.metadata?.name ?? "-" },
          ]}
          labels={getLabelEntries()}
          annotations={getAnnotationEntries()}
        />
        <div class="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div class="rounded border p-3 sm:col-span-2">
            <div class="text-xs text-muted-foreground">Addresses</div>
            {#if getAddresses().length === 0}
              <div>-</div>
            {:else}
              <div class="space-y-1">
                {#each getAddresses() as addr}
                  <div><span class="font-medium">{addr.type}:</span> {addr.address}</div>
                {/each}
              </div>
            {/if}
          </div>
          <div class="rounded border p-3">
            <div class="text-xs text-muted-foreground">OS</div>
            <div>{getNodeInfo().os}</div>
          </div>
          <div class="rounded border p-3">
            <div class="text-xs text-muted-foreground">OS Image</div>
            <div>{getNodeInfo().osImage}</div>
          </div>
          <div class="rounded border p-3">
            <div class="text-xs text-muted-foreground">Kernel version</div>
            <div>{getNodeInfo().kernelVersion}</div>
          </div>
          <div class="rounded border p-3">
            <div class="text-xs text-muted-foreground">Container runtime</div>
            <div>{getNodeInfo().containerRuntime}</div>
          </div>
          <div class="rounded border p-3">
            <div class="text-xs text-muted-foreground">Kubelet version</div>
            <div>{getNodeInfo().kubeletVersion}</div>
          </div>
          <div class="rounded border p-3">
            <div class="text-xs text-muted-foreground">Conditions</div>
            <div
              class={`mt-1 inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs ${
                isReadyCondition()
                  ? "border-emerald-300/60 bg-emerald-100/40 text-emerald-700 dark:text-emerald-300"
                  : "border-rose-300/60 bg-rose-100/40 text-rose-700 dark:text-rose-300"
              }`}
            >
              <span class={`inline-block h-1.5 w-1.5 rounded-full ${isReadyCondition() ? "bg-emerald-500" : "bg-rose-500"}`}></span>
              {getReadyCondition()}
            </div>
          </div>
        </div>

        <h3 class="my-4 flex items-center gap-2 font-bold">
          <Database class="h-4 w-4 text-muted-foreground" />
          Capacity
        </h3>
        <div class="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div class="rounded border p-2">
            <div class="text-xs text-muted-foreground">CPU</div>
            <div class="font-medium">{getCapacity().capacity.cpu}</div>
          </div>
          <div class="rounded border p-2">
            <div class="text-xs text-muted-foreground">Memory</div>
            <div class="font-medium">{getCapacity().capacity.memory}</div>
          </div>
          <div class="rounded border p-2">
            <div class="text-xs text-muted-foreground">Ephemeral storage</div>
            <div class="font-medium">{getCapacity().capacity.disk}</div>
          </div>
          <div class="rounded border p-2">
            <div class="text-xs text-muted-foreground">Pods</div>
            <div class="font-medium">{getCapacity().capacity.pods}</div>
          </div>
        </div>

        <h3 class="my-4 flex items-center gap-2 font-bold">
          <Server class="h-4 w-4 text-muted-foreground" />
          Allocatable
        </h3>
        <div class="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div class="rounded border p-2">
            <div class="text-xs text-muted-foreground">CPU</div>
            <div class="font-medium">{getCapacity().allocatable.cpu}</div>
          </div>
          <div class="rounded border p-2">
            <div class="text-xs text-muted-foreground">Memory</div>
            <div class="font-medium">{getCapacity().allocatable.memory}</div>
          </div>
          <div class="rounded border p-2">
            <div class="text-xs text-muted-foreground">Ephemeral storage</div>
            <div class="font-medium">{getCapacity().allocatable.disk}</div>
          </div>
          <div class="rounded border p-2">
            <div class="text-xs text-muted-foreground">Pods</div>
            <div class="font-medium">{getCapacity().allocatable.pods}</div>
          </div>
        </div>

        <div bind:this={topSectionElement}>
          <h3 class="my-4 flex items-center gap-2 font-bold">
            <Activity class="h-4 w-4 text-muted-foreground" />
            Top node
          </h3>
        </div>
        {#if topLoading}
          <div class="rounded border p-3 text-sm text-muted-foreground">Loading node metrics...</div>
        {:else if topError}
          <div class="rounded border border-rose-300/70 bg-rose-50 p-3 text-sm text-rose-900">{topError}</div>
        {:else if topMetrics}
          <div class="grid grid-cols-2 gap-2 text-sm">
            <div class="rounded border p-2">
              <div class="text-xs text-muted-foreground">CPU</div>
              <div class="font-medium">{topMetrics.cpu}</div>
              <div class="text-xs text-muted-foreground">{topMetrics.cpuPercent}</div>
            </div>
            <div class="rounded border p-2">
              <div class="text-xs text-muted-foreground">Memory</div>
              <div class="font-medium">{topMetrics.memory}</div>
              <div class="text-xs text-muted-foreground">{topMetrics.memoryPercent}</div>
            </div>
          </div>
        {:else}
          <div class="rounded border p-3 text-sm text-muted-foreground">No node metrics found.</div>
        {/if}

        <h3 class="my-4 flex items-center gap-2 font-bold">
          <Activity class="h-4 w-4 text-muted-foreground" />
          Pods
        </h3>
        {#if podsLoading}
          <div class="rounded border p-3 text-sm text-muted-foreground">Loading pods...</div>
        {:else if podsError}
          <div class="rounded border border-rose-300/70 bg-rose-50 p-3 text-sm text-rose-900">{podsError}</div>
        {:else if pods.length === 0}
          <div class="rounded border p-3 text-sm text-muted-foreground">No pods found.</div>
        {:else}
          <div class="rounded border">
            <div class="grid grid-cols-1 gap-2 border-b bg-muted/40 px-2 py-2 text-xs font-medium text-muted-foreground sm:grid-cols-[2.2fr_2.2fr_1.5fr_0.9fr_1fr]">
              <div>Name</div>
              <div>Node</div>
              <div>Namespace</div>
              <div>Ready</div>
              <div>Status</div>
            </div>
            {#each pods as pod}
              <div class="grid grid-cols-1 gap-2 border-b px-2 py-2 text-sm last:border-b-0 sm:grid-cols-[2.2fr_2.2fr_1.5fr_0.9fr_1fr]">
                <div>{pod.name}</div>
                <div>{pod.node}</div>
                <div>{pod.namespace}</div>
                <div class={getReadyTone(pod.ready)}>{pod.ready}</div>
                <div>
                  <span class={`inline-flex rounded-md border px-2 py-0.5 text-xs ${getPodStatusTone(pod.status)}`}>
                    {pod.status}
                  </span>
                </div>
              </div>
            {/each}
          </div>
        {/if}

        <div bind:this={eventsSectionElement}>
          <h3 class="my-4 flex items-center gap-2 font-bold">
            <Clock3 class="h-4 w-4 text-muted-foreground" />
            Events
          </h3>
        </div>
        <DetailsEventsList {events} loading={eventsLoading} error={eventsError} emptyText="No events found." />
      </div>
</DetailsSheetPortal>
{/if}
