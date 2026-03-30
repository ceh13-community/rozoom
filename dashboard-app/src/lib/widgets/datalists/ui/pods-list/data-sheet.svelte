<script lang="ts">
  import {
    loadPodEvents as loadPodEventsFromCluster,
    podPhaseToState,
    containerLabelToState,
    extractPodIp,
    type PodEvent,
  } from "$features/pod-details";
  import { getEnvironmentInfo, type Container } from "$entities/pod";
  import { timeAgo, type PodItem } from "$shared";
  import * as Sheet from "$shared/ui/sheet";
  import { ChevronDown, ChevronUp } from "$shared/ui/icons";
  import { InitContainers } from "$widgets/pods";
  import Archive from "@lucide/svelte/icons/archive";
  import Bug from "@lucide/svelte/icons/bug";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Copy from "@lucide/svelte/icons/copy";
  import FileDown from "@lucide/svelte/icons/file-down";
  import FileText from "@lucide/svelte/icons/file-text";
  import Info from "@lucide/svelte/icons/info";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plug from "@lucide/svelte/icons/plug";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import Search from "@lucide/svelte/icons/search";
  import Terminal from "@lucide/svelte/icons/terminal";
  import Link2 from "@lucide/svelte/icons/link-2";
  import Trash from "@lucide/svelte/icons/trash";
  import UserX from "@lucide/svelte/icons/user-x";
  import { tick } from "svelte";
  import type { Writable } from "svelte/store";
  import * as Table from "$shared/ui/table";
  import DetailsHeaderActions from "../common/details-header-actions.svelte";
  import DetailsMetadataGrid from "../common/details-metadata-grid.svelte";
  import DetailsEventsList from "../common/details-events-list.svelte";

  interface PodSheetProps {
    clusterId: string;
    data: Writable<Partial<PodItem> | null>;
    isOpen: Writable<boolean>;
    metricsByKey: Map<string, { cpu: string; memory: string }>;
    metricsError: string | null;
    onShell: (pod: Partial<PodItem>) => void;
    onAttach: (pod: Partial<PodItem>) => void;
    onEditYaml: (pod: Partial<PodItem>) => void;
    onInvestigate: (pod: Partial<PodItem>) => void;
    onCopyDescribe: (pod: Partial<PodItem>) => void;
    onRunDebugDescribe: (pod: Partial<PodItem>) => void;
    onCopyDebug: (pod: Partial<PodItem>) => void;
    onDownloadYaml: (pod: Partial<PodItem>) => void;
    onExportIncident: (pod: Partial<PodItem>) => void;
    onEvict: (pod: Partial<PodItem>) => void;
    onPortForward: (pod: Partial<PodItem>) => void;
    onLogs: (pod: Partial<PodItem>) => void;
    onPreviousLogs: (pod: Partial<PodItem>) => void;
    onDelete: (pod: Partial<PodItem>) => void;
  }

  const {
    clusterId,
    data,
    isOpen,
    metricsByKey,
    metricsError,
    onShell,
    onAttach,
    onEditYaml,
    onInvestigate,
    onCopyDescribe,
    onRunDebugDescribe,
    onCopyDebug,
    onDownloadYaml,
    onExportIncident,
    onEvict,
    onPortForward,
    onLogs,
    onPreviousLogs,
    onDelete,
  }: PodSheetProps = $props();

  type PodStatusLike = Partial<PodItem["status"]> & {
    conditions?: Array<{ type?: string; status?: string }>;
    podIPs?: Array<{ ip?: string }>;
  };

  type PodSpecLike = Partial<PodItem["spec"]> & {
    serviceAccountName?: string;
    nodeSelector?: Record<string, string>;
    imagePullSecrets?: Array<{ name?: string }>;
    tolerations?: Array<{
      key?: string;
      operator?: string;
      effect?: string;
      tolerationSeconds?: number;
    }>;
    volumes?: Array<Record<string, unknown>>;
    initContainers?: PodItem["spec"]["containers"];
    containers?: Container[];
  };

  type PodMetadataLike = Partial<PodItem["metadata"]> & {
    annotations?: Record<string, string>;
    ownerReferences?: Array<{ kind?: string; name?: string; controller?: boolean }>;
  };

  function getMetrics(pod: Partial<PodItem>) {
    const name = pod.metadata?.name;
    if (!name) return null;
    const namespace = pod.metadata?.namespace ?? "default";
    return metricsByKey.get(`${namespace}/${name}`) ?? null;
  }

  async function runAction(action: (pod: Partial<PodItem>) => void) {
    if (!$data) return;
    isOpen.set(false);
    await tick();
    action($data);
  }

  let initContainers = $state<PodItem["spec"]["containers"] | null>(null);
  let podEvents = $state<PodEvent[]>([]);
  let eventsLoading = $state(false);
  let eventsError = $state<string | null>(null);
  let eventsRequestId = 0;
  let showTolerations = $state(false);
  let expandedVolumeTypes = $state(new Set<string>());
  let expandedContainerEnvs = $state(new Set<string>());
  let expandedContainerMounts = $state(new Set<string>());

  function getContainerStateLabel(containerName: string) {
    const statuses = ($data?.status as PodStatusLike | undefined)?.containerStatuses ?? [];
    const status = statuses.find((item) => item.name === containerName);
    if (!status) return "-";
    if (status.state?.running) return status.ready ? "running, ready" : "running";
    if (status.state?.waiting) {
      const reason = status.state.waiting.reason?.trim();
      return reason ? `waiting (${reason})` : "waiting";
    }
    if (status.state?.terminated) {
      const reason = status.state.terminated.reason?.trim();
      return reason ? `terminated (${reason})` : "terminated";
    }
    return status.ready ? "ready" : "not ready";
  }

  function getStatusToneClasses(state: ReturnType<typeof podPhaseToState>) {
    if (state === "ready") {
      return {
        dot: "bg-emerald-500",
        text: "text-emerald-700 dark:text-emerald-300",
      };
    }
    if (state === "progressing") {
      return {
        dot: "bg-amber-500",
        text: "text-amber-700 dark:text-amber-300",
      };
    }
    if (state === "error") {
      return {
        dot: "bg-rose-500",
        text: "text-rose-700 dark:text-rose-300",
      };
    }
    return {
      dot: "bg-slate-400",
      text: "text-slate-700 dark:text-slate-300",
    };
  }

  function getContainerPort(probePort: string | number | undefined, container: Container) {
    if (probePort === undefined) return "-";
    if (typeof probePort === "number") return String(probePort);
    const resolved = container.ports?.find((port) => port.name === probePort)?.containerPort;
    return String(resolved ?? probePort);
  }

  function formatProbe(probe: Container["livenessProbe"], container: Container) {
    if (!probe) return "-";
    const parts: string[] = [];
    if (probe.httpGet) {
      const scheme = (probe.httpGet.scheme ?? "HTTP").toLowerCase();
      const port = getContainerPort(probe.httpGet.port, container);
      const path = probe.httpGet.path ?? "";
      parts.push(`http-get ${scheme}://:${port}${path}`);
    }
    if (probe.initialDelaySeconds !== undefined) parts.push(`delay=${probe.initialDelaySeconds}s`);
    if (probe.timeoutSeconds !== undefined) parts.push(`timeout=${probe.timeoutSeconds}s`);
    if (probe.periodSeconds !== undefined) parts.push(`period=${probe.periodSeconds}s`);
    if (probe.successThreshold !== undefined) parts.push(`#success=${probe.successThreshold}`);
    if (probe.failureThreshold !== undefined) parts.push(`#failure=${probe.failureThreshold}`);
    return parts.length > 0 ? parts.join(" ") : "-";
  }

  function formatResources(resources: Container["resources"] | undefined, type: "requests" | "limits") {
    const value = resources?.[type];
    const cpu = value?.cpu ?? "-";
    const memory = value?.memory ?? "-";
    return `CPU: ${cpu}, Memory: ${memory}`;
  }

  function toTitleCase(input: string) {
    return input
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/(^\w|\s\w)/g, (char) => char.toUpperCase());
  }

  function getCreatedLabel() {
    const createdAt = ($data?.metadata as PodMetadataLike | undefined)?.creationTimestamp;
    if (!createdAt) return "-";
    return `${timeAgo(new Date(createdAt))} (${createdAt})`;
  }

  function getControlledBy() {
    const metadata = ($data?.metadata as PodMetadataLike | undefined) ?? undefined;
    const owner = metadata?.ownerReferences?.find(
      (reference) => (reference as { controller?: boolean }).controller,
    ) ??
      metadata?.ownerReferences?.[0];
    if (!owner?.kind || !owner?.name) return "-";
    return `${owner.kind} ${owner.name}`;
  }

  function getPodIps() {
    const status = ($data?.status as PodStatusLike | undefined) ?? undefined;
    const ips = status?.podIPs?.map((item) => item.ip).filter((value): value is string => Boolean(value)) ?? [];
    if (ips.length > 0) return ips.join(", ");
    return extractPodIp($data ?? {});
  }

  function getConditionsLabel() {
    const status = ($data?.status as PodStatusLike | undefined) ?? undefined;
    const conditions = status?.conditions ?? [];
    if (conditions.length === 0) return "-";
    return conditions.map((condition) => condition.type ?? "-").join(", ");
  }

  function getNodeSelectorLabel() {
    const selector = (($data?.spec as PodSpecLike | undefined)?.nodeSelector ?? {}) as Record<string, string>;
    const entries = Object.entries(selector);
    if (entries.length === 0) return "-";
    return entries.map(([key, value]) => `${key}: ${value}`).join(", ");
  }

  function getTolerationsCount() {
    return (($data?.spec as PodSpecLike | undefined)?.tolerations ?? []).length;
  }

  function getSecretNames() {
    const spec = ($data?.spec as PodSpecLike | undefined) ?? undefined;
    const names = new Set<string>();
    for (const pullSecret of spec?.imagePullSecrets ?? []) {
      if (pullSecret?.name) names.add(pullSecret.name);
    }
    for (const volume of spec?.volumes ?? []) {
      const secret = volume.secret as { secretName?: string } | undefined;
      if (secret?.secretName) names.add(secret.secretName);
    }
    return [...names];
  }

  function getLabelEntries() {
    return Object.entries(
      ((($data?.metadata as PodMetadataLike | undefined)?.labels ?? {}) as Record<string, string>) ?? {},
    );
  }

  function toggleVolumeType(type: string) {
    const next = new Set(expandedVolumeTypes);
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    expandedVolumeTypes = next;
  }

  function isVolumeTypeExpanded(type: string) {
    return expandedVolumeTypes.has(type);
  }

  function toggleContainerEnv(containerName: string) {
    const next = new Set(expandedContainerEnvs);
    if (next.has(containerName)) {
      next.delete(containerName);
    } else {
      next.add(containerName);
    }
    expandedContainerEnvs = next;
  }

  function isContainerEnvExpanded(containerName: string) {
    return expandedContainerEnvs.has(containerName);
  }

  function toggleContainerMounts(containerName: string) {
    const next = new Set(expandedContainerMounts);
    if (next.has(containerName)) {
      next.delete(containerName);
    } else {
      next.add(containerName);
    }
    expandedContainerMounts = next;
  }

  function isContainerMountsExpanded(containerName: string) {
    return expandedContainerMounts.has(containerName);
  }

  function getTolerations() {
    return (($data?.spec as PodSpecLike | undefined)?.tolerations ?? []).map((toleration) => ({
      key: toleration.key ?? "-",
      operator: toleration.operator ?? "-",
      effect: toleration.effect ?? "-",
      seconds: toleration.tolerationSeconds ?? "-",
    }));
  }

  function getVolumesByType() {
    const spec = ($data?.spec as PodSpecLike | undefined) ?? undefined;
    const grouped = new Map<string, Array<Record<string, unknown>>>();
    for (const volume of spec?.volumes ?? []) {
      const type = Object.keys(volume).find((key) => key !== "name") ?? "unknown";
      const bucket = grouped.get(type) ?? [];
      bucket.push(volume);
      grouped.set(type, bucket);
    }
    return [...grouped.entries()];
  }

  function getVolumeDetailLines(volumeType: string, volume: Record<string, unknown>) {
    const name = String(volume.name ?? "-");
    const source = (volume[volumeType] as Record<string, unknown> | undefined) ?? {};
    if (volumeType === "configMap") {
      return [`${name} -> ${String(source.name ?? "-")}`];
    }
    if (volumeType === "secret") {
      return [`${name} -> ${String(source.secretName ?? "-")}`];
    }
    if (volumeType === "emptyDir") {
      const medium = String(source.medium ?? "default");
      const size = String(source.sizeLimit ?? "-");
      return [`${name} -> medium=${medium}, sizeLimit=${size}`];
    }
    if (volumeType === "projected") {
      const sources = Array.isArray(source.sources) ? source.sources.length : 0;
      return [`${name} -> sources=${sources}`];
    }
    if (volumeType === "persistentVolumeClaim") {
      return [`${name} -> claim=${String(source.claimName ?? "-")}`];
    }
    if (volumeType === "hostPath") {
      return [`${name} -> path=${String(source.path ?? "-")}`];
    }
    return [name];
  }

  function getAnnotationEntries() {
    return Object.entries(
      ((($data?.metadata as PodMetadataLike | undefined)?.annotations ?? {}) as Record<string, string>) ?? {},
    );
  }

  $effect(() => {
    const spec = ($data?.spec as { initContainers?: PodItem["spec"]["containers"] } | undefined) ??
      undefined;
    initContainers = spec?.initContainers ?? null;
  });

  $effect(() => {
    // Reset expanded metadata sections on pod change.
    $data?.metadata?.uid;
    showTolerations = false;
    expandedVolumeTypes = new Set<string>();
    expandedContainerEnvs = new Set<string>();
    expandedContainerMounts = new Set<string>();
  });

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
    const podName = pod.metadata?.name;
    const namespace = pod.metadata?.namespace;
    if (!podName || !namespace) return;
    const currentRequest = ++eventsRequestId;
    eventsLoading = true;
    eventsError = null;
    try {
      const result = await loadPodEventsFromCluster(clusterId, pod);
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

<Sheet.Root bind:open={$isOpen}>
  <Sheet.Content showCloseControl={false} class="z-[140] flex h-[100dvh] w-full flex-col sm:max-w-[70vw]">
    <div class="flex-1 overflow-y-auto p-4">
      {#if $data}
        <div class="-mx-4 mb-4 sticky top-0 z-20 border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0 flex items-center gap-2">
              <Info class="h-4 w-4 shrink-0 text-muted-foreground" />
              <div class="truncate text-base font-semibold">Pod: {$data.metadata?.name}</div>
            </div>
            <DetailsHeaderActions
              actions={[
                { id: "shell", title: "Shell", ariaLabel: "Shell", icon: Terminal, onClick: () => runAction(onShell) },
                { id: "attach", title: "Attach pod", ariaLabel: "Attach pod", icon: Plug, onClick: () => runAction(onAttach) },
                { id: "edit-yaml", title: "Edit YAML", ariaLabel: "Edit YAML", icon: Pencil, onClick: () => runAction(onEditYaml) },
                {
                  id: "investigate",
                  title: "Investigate",
                  ariaLabel: "Investigate",
                  icon: Search,
                  onClick: () => runAction(onInvestigate),
                },
                {
                  id: "download-yaml",
                  title: "Download YAML",
                  ariaLabel: "Download YAML",
                  icon: FileDown,
                  onClick: () => runAction(onDownloadYaml),
                },
                {
                  id: "copy-describe",
                  title: "Copy kubectl describe",
                  ariaLabel: "Copy kubectl describe",
                  icon: ClipboardList,
                  onClick: () => runAction(onCopyDescribe),
                },
                {
                  id: "run-debug-describe",
                  title: "Run debug describe",
                  ariaLabel: "Run debug describe",
                  icon: Bug,
                  onClick: () => runAction(onRunDebugDescribe),
                },
                {
                  id: "copy-debug",
                  title: "Copy kubectl debug",
                  ariaLabel: "Copy kubectl debug",
                  icon: Copy,
                  onClick: () => runAction(onCopyDebug),
                },
                {
                  id: "previous-logs",
                  title: "Previous logs",
                  ariaLabel: "Previous logs",
                  icon: RotateCcw,
                  onClick: () => runAction(onPreviousLogs),
                },
                {
                  id: "export-incident",
                  title: "Export incident",
                  ariaLabel: "Export incident",
                  icon: Archive,
                  onClick: () => runAction(onExportIncident),
                },
                {
                  id: "evict",
                  title: "Evict (one-way)",
                  ariaLabel: "Evict (one-way)",
                  icon: UserX,
                  onClick: () => runAction(onEvict),
                },
                {
                  id: "port-forward",
                  title: "Port-forward preview",
                  ariaLabel: "Port-forward preview",
                  icon: Link2,
                  onClick: () => runAction(onPortForward),
                },
                { id: "logs", title: "Logs", ariaLabel: "Logs", icon: ScrollText, onClick: () => runAction(onLogs) },
                {
                  id: "delete",
                  title: "Delete",
                  ariaLabel: "Delete",
                  icon: Trash,
                  destructive: true,
                  onClick: () => runAction(onDelete),
                },
              ]}
              closeAriaLabel="Close details"
              closeTitle="Close details"
              onClose={() => isOpen.set(false)}
            />
          </div>
          <div class="text-xs text-muted-foreground">
            Namespace: {$data.metadata?.namespace || "default"} · Node: {$data.spec?.nodeName || "-"} · Pod IP:
            {extractPodIp($data)}
          </div>
        </div>
        <h3 class="my-4 font-bold">Properties</h3>
        {@const podState = podPhaseToState($data.status?.phase)}
        {@const podTone = getStatusToneClasses(podState)}
        <DetailsMetadataGrid
          contextKey={`${$data.metadata?.namespace ?? "default"}/${$data.metadata?.name ?? "-"}`}
          fields={[
            { label: "Created", value: getCreatedLabel() },
            { label: "Name", value: $data.metadata?.name ?? "-" },
            { label: "Namespace", value: $data.metadata?.namespace ?? "default" },
            { label: "Controlled By", value: getControlledBy() },
            {
              label: "Status",
              value: $data.status?.phase ?? "-",
              valueClass: `inline-flex items-center gap-2 font-medium ${podTone.text}`,
            },
          ]}
          labels={getLabelEntries()}
          annotations={getAnnotationEntries()}
        />
        <div class="my-2"></div>
        <Table.Root>
          <Table.Body>
            <Table.Row>
              <Table.Cell>Node</Table.Cell>
              <Table.Cell>{$data.spec?.nodeName ?? "-"}</Table.Cell>
            </Table.Row>
            <Table.Row>
              <Table.Cell>Pod IP</Table.Cell>
              <Table.Cell>{extractPodIp($data)}</Table.Cell>
            </Table.Row>
            <Table.Row>
              <Table.Cell>Pod IPs</Table.Cell>
              <Table.Cell>{getPodIps()}</Table.Cell>
            </Table.Row>
            <Table.Row>
              <Table.Cell>Service Account</Table.Cell>
              <Table.Cell>{(($data.spec as PodSpecLike | undefined)?.serviceAccountName ?? "-") as string}</Table.Cell>
            </Table.Row>
            <Table.Row>
              <Table.Cell>QoS Class</Table.Cell>
              <Table.Cell>{$data.status?.qosClass ?? "-"}</Table.Cell>
            </Table.Row>
            <Table.Row>
              <Table.Cell>Conditions</Table.Cell>
              <Table.Cell>{getConditionsLabel()}</Table.Cell>
            </Table.Row>
            <Table.Row>
              <Table.Cell>Node Selector</Table.Cell>
              <Table.Cell>{getNodeSelectorLabel()}</Table.Cell>
            </Table.Row>
            <Table.Row class={`cursor-pointer transition-colors ${showTolerations ? "bg-sky-50/70 dark:bg-sky-500/10" : "hover:bg-muted/40"}`} onclick={() => (showTolerations = !showTolerations)}>
              <Table.Cell>Tolerations</Table.Cell>
              <Table.Cell>
                <div class="flex items-center justify-between gap-2">
                  <span>{getTolerationsCount()} Tolerations</span>
                  {#if showTolerations}
                    <ChevronUp class="h-4 w-4 text-sky-700 dark:text-sky-300" />
                  {:else}
                    <ChevronDown class="h-4 w-4 text-muted-foreground" />
                  {/if}
                </div>
                {#if showTolerations}
                  <div class="mt-2 space-y-1 rounded border border-sky-200/60 bg-sky-50/70 p-2 text-xs dark:border-sky-500/30 dark:bg-sky-500/10">
                    {#if getTolerations().length === 0}
                      <div class="text-muted-foreground">No tolerations.</div>
                    {:else}
                      {#each getTolerations() as toleration}
                        <div class="break-all">
                          <span class="font-medium">{toleration.key}</span>
                          · {toleration.operator} · {toleration.effect} · {toleration.seconds}
                        </div>
                      {/each}
                    {/if}
                  </div>
                {/if}
              </Table.Cell>
            </Table.Row>
            <Table.Row>
              <Table.Cell>Secrets</Table.Cell>
              <Table.Cell>{getSecretNames().length > 0 ? getSecretNames().join(", ") : "-"}</Table.Cell>
            </Table.Row>
          </Table.Body>
        </Table.Root>
        <h3 class="my-4 font-bold">Metrics</h3>
        {#if metricsError}
          <div class="text-sm text-muted-foreground">{metricsError}</div>
        {:else}
          {#if getMetrics($data)}
            <Table.Root>
              <Table.Body>
                <Table.Row>
                  <Table.Cell>CPU</Table.Cell>
                  <Table.Cell>{getMetrics($data)?.cpu ?? "-"}</Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell>Memory</Table.Cell>
                  <Table.Cell>{getMetrics($data)?.memory ?? "-"}</Table.Cell>
                </Table.Row>
              </Table.Body>
            </Table.Root>
          {:else}
            <div class="text-sm text-muted-foreground">No metrics available.</div>
          {/if}
        {/if}
        <h3 class="my-4 font-bold">Pod Volumes</h3>
        {#if (($data?.spec as PodSpecLike | undefined)?.volumes ?? []).length > 0}
          <Table.Root>
            <Table.Body>
              {#each getVolumesByType() as [volumeType, volumes]}
                <Table.Row class={`cursor-pointer transition-colors ${isVolumeTypeExpanded(volumeType) ? "bg-sky-50/70 dark:bg-sky-500/10" : "hover:bg-muted/40"}`} onclick={() => toggleVolumeType(volumeType)}>
                  <Table.Cell>{toTitleCase(volumeType)}</Table.Cell>
                  <Table.Cell>
                    <div class="flex items-center justify-between gap-2">
                      <span>{volumes.length} volume{volumes.length === 1 ? "" : "s"}</span>
                      {#if isVolumeTypeExpanded(volumeType)}
                        <ChevronUp class="h-4 w-4 text-sky-700 dark:text-sky-300" />
                      {:else}
                        <ChevronDown class="h-4 w-4 text-muted-foreground" />
                      {/if}
                    </div>
                    {#if isVolumeTypeExpanded(volumeType)}
                      <div class="mt-2 space-y-1 rounded border border-sky-200/60 bg-sky-50/70 p-2 text-xs dark:border-sky-500/30 dark:bg-sky-500/10">
                        {#each volumes as volume}
                          {#each getVolumeDetailLines(volumeType, volume) as detail}
                            <div class="break-all">{detail}</div>
                          {/each}
                        {/each}
                      </div>
                    {/if}
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        {:else}
          <div class="text-sm text-muted-foreground">No volumes.</div>
        {/if}
        <h3 class="my-4 font-bold">Containers</h3>
        {#if (($data?.spec as PodSpecLike | undefined)?.containers ?? []).length > 0}
          {#each (($data.spec as PodSpecLike | undefined)?.containers ?? []) as container}
            <h4 class="mb-2 mt-4 font-semibold">{container.name}</h4>
            <Table.Root>
              <Table.Body>
                <Table.Row>
                  <Table.Cell>Status</Table.Cell>
                  <Table.Cell>
                    {@const containerStatus = getContainerStateLabel(container.name)}
                    {@const containerTone = getStatusToneClasses(containerLabelToState(containerStatus))}
                    <span class={`inline-flex items-center gap-2 font-medium ${containerTone.text}`}>
                      <span class={`inline-block h-2.5 w-2.5 rounded-full ${containerTone.dot}`}></span>
                      {containerStatus}
                    </span>
                  </Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell>Image</Table.Cell>
                  <Table.Cell>{container.image ?? "-"}</Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell>ImagePullPolicy</Table.Cell>
                  <Table.Cell>{container.imagePullPolicy ?? "-"}</Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell>Ports</Table.Cell>
                  <Table.Cell>
                    {#if (container.ports ?? []).length > 0}
                      {container.ports
                        ?.map((port) => `${port.containerPort}/${port.protocol ?? "TCP"}`)
                        .join(", ")}
                    {:else}
                      -
                    {/if}
                  </Table.Cell>
                </Table.Row>
                <Table.Row class={`cursor-pointer transition-colors ${isContainerEnvExpanded(container.name) ? "bg-sky-50/70 dark:bg-sky-500/10" : "hover:bg-muted/40"}`} onclick={() => toggleContainerEnv(container.name)}>
                  <Table.Cell>Environment</Table.Cell>
                  <Table.Cell>
                    <div class="flex items-center justify-between gap-2">
                      <span>{container.env?.length ?? 0} Environmental Variables</span>
                      {#if isContainerEnvExpanded(container.name)}
                        <ChevronUp class="h-4 w-4 text-sky-700 dark:text-sky-300" />
                      {:else}
                        <ChevronDown class="h-4 w-4 text-muted-foreground" />
                      {/if}
                    </div>
                    {#if isContainerEnvExpanded(container.name)}
                      <div class="mt-2 space-y-1 rounded border border-sky-200/60 bg-sky-50/70 p-2 text-xs dark:border-sky-500/30 dark:bg-sky-500/10">
                        {#if (container.env ?? []).length === 0}
                          <div class="text-muted-foreground">No environment variables.</div>
                        {:else}
                          {#each [...(container.env ?? [])].sort((a, b) => a.name.localeCompare(b.name)) as env}
                            <div class="break-all">{getEnvironmentInfo(env)}</div>
                          {/each}
                        {/if}
                      </div>
                    {/if}
                  </Table.Cell>
                </Table.Row>
                <Table.Row class={`cursor-pointer transition-colors ${isContainerMountsExpanded(container.name) ? "bg-sky-50/70 dark:bg-sky-500/10" : "hover:bg-muted/40"}`} onclick={() => toggleContainerMounts(container.name)}>
                  <Table.Cell>Mounts</Table.Cell>
                  <Table.Cell>
                    <div class="flex items-center justify-between gap-2">
                      <span>{container.volumeMounts?.length ?? 0} Mounts</span>
                      {#if isContainerMountsExpanded(container.name)}
                        <ChevronUp class="h-4 w-4 text-sky-700 dark:text-sky-300" />
                      {:else}
                        <ChevronDown class="h-4 w-4 text-muted-foreground" />
                      {/if}
                    </div>
                    {#if isContainerMountsExpanded(container.name)}
                      <div class="mt-2 space-y-1 rounded border border-sky-200/60 bg-sky-50/70 p-2 text-xs dark:border-sky-500/30 dark:bg-sky-500/10">
                        {#if (container.volumeMounts ?? []).length === 0}
                          <div class="text-muted-foreground">No mounts.</div>
                        {:else}
                          {#each container.volumeMounts ?? [] as mount}
                            <div class="break-all">
                              {mount.mountPath} from {mount.name} ({mount.readOnly ? "ro" : "rw"})
                            </div>
                          {/each}
                        {/if}
                      </div>
                    {/if}
                  </Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell>Liveness</Table.Cell>
                  <Table.Cell>{formatProbe(container.livenessProbe, container)}</Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell>Readiness</Table.Cell>
                  <Table.Cell>{formatProbe(container.readinessProbe, container)}</Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell>Arguments</Table.Cell>
                  <Table.Cell>{(container.args ?? []).length > 0 ? container.args?.join(" ") : "-"}</Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell>Requests</Table.Cell>
                  <Table.Cell>{formatResources(container.resources, "requests")}</Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell>Limits</Table.Cell>
                  <Table.Cell>{formatResources(container.resources, "limits")}</Table.Cell>
                </Table.Row>
              </Table.Body>
            </Table.Root>
          {/each}
        {:else}
          <div class="text-sm text-muted-foreground">No container status data.</div>
        {/if}
        <h3 class="my-4 font-bold">Init Containers</h3>
        {#if initContainers}
          <InitContainers containers={initContainers} />
        {:else}
          <div class="text-sm text-muted-foreground">No init containers.</div>
        {/if}
        <h3 class="my-4 font-bold">Events</h3>
        <DetailsEventsList
          events={podEvents}
          loading={eventsLoading}
          error={eventsError}
          emptyText="No events for this pod."
        />
      {/if}
    </div>
  </Sheet.Content>
</Sheet.Root>
