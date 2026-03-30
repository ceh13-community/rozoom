<script lang="ts">
  import { getTimeDifference } from "$shared";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import ArrowUpDown from "@lucide/svelte/icons/arrow-up-down";
  import Bug from "@lucide/svelte/icons/bug";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Clock3 from "@lucide/svelte/icons/clock-3";
  import FileDown from "@lucide/svelte/icons/file-down";
  import Info from "@lucide/svelte/icons/info";
  import ListTree from "@lucide/svelte/icons/list-tree";
  import Pause from "@lucide/svelte/icons/pause";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Play from "@lucide/svelte/icons/play";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import Search from "@lucide/svelte/icons/search";
  import Trash from "@lucide/svelte/icons/trash";
  import { tick } from "svelte";
  import type { Writable } from "svelte/store";
  import DetailsHeaderActions from "./common/details-header-actions.svelte";
  import DetailsMetadataGrid from "./common/details-metadata-grid.svelte";
  import ResourceTrafficChain from "./common/resource-traffic-chain.svelte";
  import DetailsEventsList from "./common/details-events-list.svelte";
  import DetailsExplainState from "./common/details-explain-state.svelte";
  import { buildKubectlDescribeCommand } from "./common/kubectl-command-builder";
  import DetailsSheetPortal from "$shared/ui/details-sheet-portal.svelte";

  type ResourceItem = {
    metadata?: {
      name?: string;
      namespace?: string;
      labels?: unknown;
      annotations?: unknown;
      ownerReferences?: unknown;
      creationTimestamp?: unknown;
    };
    spec?: unknown;
    status?: unknown;
  };
  type ResourceMetadata = NonNullable<ResourceItem["metadata"]>;

  interface ResourceDetailsSheetProps<TItem> {
    clusterId: string;
    title: string;
    selectedItem: Writable<TItem | null>;
    isOpen: Writable<boolean>;
    onLogs?: (item: TItem) => void;
    onEvents?: (item: TItem) => void;
    onScale?: (item: TItem) => void;
    onEditYaml?: (item: TItem) => void;
    onInvestigate?: (item: TItem) => void;
    onCopyDescribe?: (item: TItem) => void;
    onRunDebugDescribe?: (item: TItem) => void;
    onRolloutStatus?: (item: TItem) => void;
    onRolloutHistory?: (item: TItem) => void;
    onTrigger?: (item: TItem) => void;
    onToggleSuspend?: (item: TItem) => void;
    onDownloadYaml?: (item: TItem) => void;
    onRestart?: (item: TItem) => void;
    onDelete?: (item: TItem) => void;
    runtimeProfileLabel?: string | null;
    runtimeSourceState?: "live" | "cached" | "stale" | "paused" | "error" | "idle";
    runtimeLastUpdatedLabel?: string | null;
    runtimeDetail?: string | null;
    runtimeReason?: string | null;
    runtimeRequestPath?: string | null;
    runtimeSyncError?: string | null;
    events?: Array<{
      type?: string;
      reason?: string;
      message?: string;
      lastTimestamp?: string;
      source?: string;
      count?: string | number;
    }>;
    eventsLoading?: boolean;
    eventsError?: string | null;
  }

  const {
    clusterId,
    title,
    selectedItem,
    isOpen,
    onLogs,
    onEvents,
    onScale,
    onEditYaml,
    onInvestigate,
    onCopyDescribe,
    onRunDebugDescribe,
    onRolloutStatus,
    onRolloutHistory,
    onTrigger,
    onToggleSuspend,
    onDownloadYaml,
    onRestart,
    onDelete,
    runtimeProfileLabel = null,
    runtimeSourceState = "idle",
    runtimeLastUpdatedLabel = null,
    runtimeDetail = null,
    runtimeReason = null,
    runtimeRequestPath = null,
    runtimeSyncError = null,
    events = [],
    eventsLoading = false,
    eventsError = null,
  }: ResourceDetailsSheetProps<any> = $props();

  function closeDetails() {
    isOpen.set(false);
  }

  async function runAction(action?: (item: ResourceItem) => void) {
    const item = $selectedItem;
    if (!item || !action) return;
    isOpen.set(false);
    await tick();
    action(item);
  }

  function getResourceLabel() {
    return title.trim().toLowerCase();
  }

  function getResourceTargetName() {
    const normalized = title.trim().toLowerCase();
    if (normalized === "stateful set") return "statefulset";
    if (normalized === "replica set") return "replicaset";
    if (normalized === "cron job") return "cronjob";
    return normalized.replace(/\s+/g, "");
  }

  function getDescribeCommand() {
    const metadata = getMetadata();
    const name = metadata.name;
    if (!name) return null;
    return buildKubectlDescribeCommand({
      resource: getResourceTargetName(),
      name,
      namespace: metadata.namespace,
      namespaceScoped: !isNodeDetails(),
    });
  }

  function isScheduleSuspended() {
    return getSpec().suspend === true;
  }

  function isCronJobDetails() {
    return title === "Cron Job";
  }

  function isJobDetails() {
    return title === "Job";
  }

  function isReplicaSetDetails() {
    return title === "Replica Set";
  }

  function isStatefulSetDetails() {
    return title === "Stateful Set";
  }

  function isNodeDetails() {
    return title === "Node";
  }

  let showImagesDetails = $state(false);
  let showConditionsDetails = $state(false);
  let showPodAntiAffinitiesDetails = $state(false);
  let showTolerationsDetails = $state(false);
  let showJobConditionsDetails = $state(false);

  let previousDetailsKey = $state<string | null>(null);
  $effect(() => {
    const key = $selectedItem
      ? `${$selectedItem?.metadata?.namespace ?? "default"}/${$selectedItem?.metadata?.name ?? "-"}`
      : null;
    if (!$isOpen || !key || key === previousDetailsKey) return;
    previousDetailsKey = key;
    showImagesDetails = false;
    showConditionsDetails = false;
    showPodAntiAffinitiesDetails = false;
    showTolerationsDetails = false;
    showJobConditionsDetails = false;
  });

  function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }

  function asStringRecord(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const output: Record<string, string> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      output[key] = String(raw);
    }
    return output;
  }

  function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  function getSpec(): Record<string, unknown> {
    return asRecord($selectedItem?.spec) ?? {};
  }

  function getStatus(): Record<string, unknown> {
    return asRecord($selectedItem?.status) ?? {};
  }

  function getTemplateSpec(): Record<string, unknown> {
    const spec = getSpec();
    const template = asRecord(spec.template);
    return asRecord(template?.spec) ?? {};
  }

  function getJobTemplateSpec(): Record<string, unknown> {
    const spec = getSpec();
    const jobTemplate = asRecord(spec.jobTemplate);
    const jobTemplateSpec = asRecord(jobTemplate?.spec);
    const template = asRecord(jobTemplateSpec?.template);
    return asRecord(template?.spec) ?? {};
  }

  function getMetadata(): ResourceMetadata {
    return ($selectedItem?.metadata ?? {}) as ResourceMetadata;
  }

  function getLabelEntries() {
    return Object.entries(getMetadata().labels ?? {});
  }

  function getAnnotationEntries() {
    return Object.entries(getMetadata().annotations ?? {});
  }

  function getCreatedLabel() {
    const createdRaw = getMetadata().creationTimestamp;
    if (!createdRaw) return "-";
    const createdAt = createdRaw instanceof Date ? createdRaw : new Date(String(createdRaw));
    if (Number.isNaN(createdAt.getTime())) return "-";
    return `${getTimeDifference(createdAt)} ago (${createdAt.toLocaleString()})`;
  }

  function getSelectorLines() {
    const spec = getSpec();
    const selector = asRecord(spec.selector);
    if (!selector) return [] as string[];
    const matchLabels = asStringRecord(selector.matchLabels);
    const labelLines = Object.entries(matchLabels).map(([key, value]) => `${key}=${value}`);
    const matchExpressions = asArray(selector.matchExpressions).map((expr) => JSON.stringify(expr));
    const directLines = Object.entries(selector)
      .filter(([key]) => key !== "matchLabels" && key !== "matchExpressions")
      .map(([key, value]) => `${key}=${String(value)}`);
    return [...labelLines, ...matchExpressions, ...directLines];
  }

  function getControlledByLabel() {
    const refs = asArray(getMetadata().ownerReferences)
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    const controller = refs[0];
    if (!controller) return "-";
    const kind = typeof controller.kind === "string" ? controller.kind : "Resource";
    const name = typeof controller.name === "string" ? controller.name : "-";
    return `${kind} ${name}`;
  }

  function getNodeSelectorLines() {
    const spec = getSpec();
    const templateSpec = getTemplateSpec();
    const selectors = asStringRecord(templateSpec.nodeSelector ?? spec.nodeSelector);
    return Object.entries(selectors).map(([key, value]) => `${key}=${value}`);
  }

  function getImages() {
    const templateSpec = isCronJobDetails() ? getJobTemplateSpec() : getTemplateSpec();
    const containerLists = [asArray(templateSpec.containers), asArray(templateSpec.initContainers)];
    const images = new Set<string>();
    for (const list of containerLists) {
      for (const item of list) {
        const record = asRecord(item);
        const image = record?.image;
        if (typeof image === "string" && image.trim()) images.add(image.trim());
      }
    }
    return Array.from(images);
  }

  function getStrategyType() {
    const spec = getSpec();
    const strategy = asRecord(spec.strategy);
    const updateStrategy = asRecord(spec.updateStrategy);
    const value = strategy?.type ?? updateStrategy?.type;
    return typeof value === "string" ? value : "-";
  }

  function getReplicasLabel() {
    const spec = getSpec();
    const status = getStatus();
    const desired = typeof spec.replicas === "number" ? spec.replicas : null;
    const current = typeof status.replicas === "number" ? status.replicas : null;
    const ready = typeof status.readyReplicas === "number" ? status.readyReplicas : null;
    if (isReplicaSetDetails() && current !== null && desired !== null) return `${current} current / ${desired} desired`;
    if (ready !== null && desired !== null) return `${ready} / ${desired}`;
    if (desired !== null) return String(desired);
    if (ready !== null) return `${ready} ready`;
    return "-";
  }

  function getPodStatusSummary() {
    const status = getStatus();
    if (isJobDetails()) {
      const active = typeof status.active === "number" ? status.active : 0;
      const succeeded = typeof status.succeeded === "number" ? status.succeeded : 0;
      const failed = typeof status.failed === "number" ? status.failed : 0;
      if (active > 0) return `Active: ${active}`;
      if (succeeded > 0) return `Succeeded: ${succeeded}`;
      if (failed > 0) return `Failed: ${failed}`;
      return "-";
    }
    const running =
      typeof status.readyReplicas === "number"
        ? status.readyReplicas
        : typeof status.numberReady === "number"
          ? status.numberReady
          : typeof status.currentReplicas === "number"
            ? status.currentReplicas
            : null;
    if (running !== null) return `Running: ${running}`;
    return "-";
  }

  function getPodAntiAffinityRulesLabel() {
    const templateSpec = getTemplateSpec();
    const affinity = asRecord(templateSpec.affinity);
    const podAntiAffinity = asRecord(affinity?.podAntiAffinity);
    const required = asArray(podAntiAffinity?.requiredDuringSchedulingIgnoredDuringExecution).length;
    const preferred = asArray(podAntiAffinity?.preferredDuringSchedulingIgnoredDuringExecution).length;
    const total = required + preferred;
    return `${total} Rule${total === 1 ? "" : "s"}`;
  }

  function getPodAntiAffinityLines() {
    const templateSpec = getTemplateSpec();
    const affinity = asRecord(templateSpec.affinity);
    const podAntiAffinity = asRecord(affinity?.podAntiAffinity);
    const required = asArray(podAntiAffinity?.requiredDuringSchedulingIgnoredDuringExecution)
      .map((item) => JSON.stringify(item))
      .filter((line) => line !== undefined);
    const preferred = asArray(podAntiAffinity?.preferredDuringSchedulingIgnoredDuringExecution)
      .map((item) => JSON.stringify(item))
      .filter((line) => line !== undefined);
    return [...required, ...preferred];
  }

  function getScheduleLabel() {
    const schedule = getSpec().schedule;
    return typeof schedule === "string" && schedule.trim() ? schedule : "-";
  }

  function getCronActiveCountLabel() {
    const status = getStatus();
    return String(asArray(status.active).length);
  }

  function getSuspendLabel() {
    const suspend = getSpec().suspend;
    return suspend === true ? "true" : "false";
  }

  function getLastScheduleLabel() {
    const status = getStatus();
    const raw = status.lastScheduleTime;
    if (!raw) return "-";
    const at = raw instanceof Date ? raw : new Date(String(raw));
    if (Number.isNaN(at.getTime())) return "-";
    return `${getTimeDifference(at)} ago (${at.toLocaleString()})`;
  }

  function getNextExecutionLabel() {
    const status = getStatus();
    const raw = status.nextScheduleTime ?? status.nextExecutionTime;
    if (!raw) return "-";
    const at = raw instanceof Date ? raw : new Date(String(raw));
    if (Number.isNaN(at.getTime())) return "-";
    return `${getTimeDifference(at)} (${at.toLocaleString()})`;
  }

  function getTimeZoneLabel() {
    const zone = getSpec().timeZone;
    return typeof zone === "string" && zone.trim() ? zone : "-";
  }

  function getJobCompletionsLabel() {
    const spec = getSpec();
    const status = getStatus();
    const desired = typeof spec.completions === "number" ? spec.completions : null;
    const done = typeof status.succeeded === "number" ? status.succeeded : null;
    if (done !== null && desired !== null) return `${done} / ${desired}`;
    if (desired !== null) return String(desired);
    if (done !== null) return String(done);
    return "-";
  }

  function getParallelismLabel() {
    const parallelism = getSpec().parallelism;
    return typeof parallelism === "number" ? String(parallelism) : "-";
  }

  function getConditionSummary() {
    const status = getStatus();
    const conditions = asArray(status.conditions)
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    if (conditions.length === 0) return "-";
    const prioritized =
      conditions.find((condition) => condition.status === "True") ??
      conditions.find((condition) => condition.status === "False") ??
      conditions[0];
    const type = typeof prioritized?.type === "string" ? prioritized.type : "Unknown";
    const state = typeof prioritized?.status === "string" ? prioritized.status : "-";
    return `${type} (${state})`;
  }

  type JobHistoryRow = {
    name: string;
    status: string;
  };

  function getCronJobHistoryRows(): JobHistoryRow[] {
    if (!isCronJobDetails()) return [];
    const status = getStatus();
    return asArray(status.active)
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item) => ({
        name: typeof item.name === "string" ? item.name : "-",
        status: "Active",
      }))
      .filter((row) => row.name !== "-");
  }

  function getTolerationsCountLabel() {
    const spec = getSpec();
    const templateSpec = getTemplateSpec();
    const tolerations = asArray(templateSpec.tolerations ?? spec.tolerations);
    const count = tolerations.length;
    return `${count}`;
  }

  function getTolerationLines() {
    const spec = getSpec();
    const templateSpec = getTemplateSpec();
    const tolerations = asArray(templateSpec.tolerations ?? spec.tolerations);
    return tolerations
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item) => {
        const key = typeof item.key === "string" ? item.key : "*";
        const operator = typeof item.operator === "string" ? item.operator : "Exists";
        const value = typeof item.value === "string" ? item.value : "-";
        const effect = typeof item.effect === "string" ? item.effect : "-";
        const seconds =
          typeof item.tolerationSeconds === "number" ? String(item.tolerationSeconds) : "-";
        return `key=${key}; op=${operator}; value=${value}; effect=${effect}; seconds=${seconds}`;
      });
  }

  function getStatusLabel() {
    const status = getStatus();
    if (typeof status.phase === "string" && status.phase.trim()) return status.phase;
    const conditions = asArray(status.conditions)
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    const healthy = conditions.find((item) => item.status === "True");
    if (healthy && typeof healthy.type === "string") return healthy.type;
    if (conditions.length > 0 && typeof conditions[0]?.type === "string") return String(conditions[0].type);
    return "-";
  }

  function getStatusToneClasses(status: string) {
    const normalized = status.toLowerCase();
    if (
      normalized.includes("ready") ||
      normalized.includes("running") ||
      normalized.includes("available") ||
      normalized.includes("healthy") ||
      normalized.includes("active")
    ) {
      return {
        text: "text-emerald-700 dark:text-emerald-300",
        dot: "bg-emerald-500",
      };
    }
    if (
      normalized.includes("fail") ||
      normalized.includes("error") ||
      normalized.includes("crash") ||
      normalized.includes("backoff")
    ) {
      return {
        text: "text-rose-700 dark:text-rose-300",
        dot: "bg-rose-500",
      };
    }
    if (
      normalized.includes("pending") ||
      normalized.includes("progress") ||
      normalized.includes("creating") ||
      normalized.includes("update")
    ) {
      return {
        text: "text-amber-700 dark:text-amber-300",
        dot: "bg-amber-500",
      };
    }
    return {
      text: "text-slate-700 dark:text-slate-300",
      dot: "bg-slate-500",
    };
  }

  function getConditionLines() {
    const status = getStatus();
    const conditions = asArray(status.conditions)
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    return conditions.map((condition) => {
      const type = typeof condition.type === "string" ? condition.type : "Unknown";
      const state = typeof condition.status === "string" ? condition.status : "-";
      const reason = typeof condition.reason === "string" ? condition.reason : "";
      const message = typeof condition.message === "string" ? condition.message : "";
      const transitionRaw = condition.lastTransitionTime;
      const transitionAt =
        transitionRaw instanceof Date
          ? transitionRaw
          : typeof transitionRaw === "string"
            ? new Date(transitionRaw)
            : null;
      const transition =
        transitionAt && !Number.isNaN(transitionAt.getTime())
          ? ` · last transition ${getTimeDifference(transitionAt)} ago`
          : "";
      const details = [reason, message].filter((item) => item.trim().length > 0).join(" · ");
      return `${type}: ${state}${details ? ` · ${details}` : ""}${transition}`;
    });
  }

  type DetailsPod = {
    name: string;
    node: string;
    namespace: string;
    ready: string;
    cpu: string;
    memory: string;
    status: string;
  };

  function getPodsFromStatus(): DetailsPod[] {
    const status = getStatus();
    const candidates = [status.pods, status.items];
    for (const candidate of candidates) {
      const items = asArray(candidate);
      if (items.length === 0) continue;
      const mapped = items
        .map((raw) => asRecord(raw))
        .filter((raw): raw is Record<string, unknown> => Boolean(raw))
        .map((raw) => {
          const metadata = asRecord(raw.metadata);
          const podStatus = asRecord(raw.status);
          const spec = asRecord(raw.spec);
          const readyContainers = asArray(podStatus?.containerStatuses).filter(
            (container) => asRecord(container)?.ready === true,
          ).length;
          const totalContainers = asArray(podStatus?.containerStatuses).length;
          return {
            name: typeof metadata?.name === "string" ? metadata.name : "-",
            node: typeof spec?.nodeName === "string" ? spec.nodeName : "-",
            namespace:
              typeof metadata?.namespace === "string"
                ? metadata.namespace
                : ($selectedItem?.metadata?.namespace ?? "default"),
            ready: totalContainers > 0 ? `${readyContainers} / ${totalContainers}` : "-",
            cpu:
              typeof raw.cpu === "string"
                ? raw.cpu
                : typeof podStatus?.cpu === "string"
                  ? podStatus.cpu
                  : "-",
            memory:
              typeof raw.memory === "string"
                ? raw.memory
                : typeof podStatus?.memory === "string"
                  ? podStatus.memory
                  : "-",
            status: typeof podStatus?.phase === "string" ? podStatus.phase : "-",
          } satisfies DetailsPod;
        })
        .filter((pod) => pod.name !== "-");
      if (mapped.length > 0) return mapped;
    }
    return [];
  }

  function getHeaderActions() {
    const actions: Array<{
      id: string;
      title: string;
      ariaLabel: string;
      icon: any;
      onClick: () => void;
      destructive?: boolean;
    }> = [];

    if (onLogs) {
      actions.push({
        id: "logs",
        title: "Logs",
        ariaLabel: `Open ${getResourceLabel()} logs`,
        icon: ScrollText,
        onClick: () => {
          void runAction(onLogs);
        },
      });
    }
    if (onEvents) {
      actions.push({
        id: "events",
        title: "Events",
        ariaLabel: `Open ${getResourceLabel()} events`,
        icon: Clock3,
        onClick: () => {
          void runAction(onEvents);
        },
      });
    }
    if (onScale) {
      actions.push({
        id: "scale",
        title: "Scale",
        ariaLabel: `Scale ${getResourceLabel()}`,
        icon: ArrowUpDown,
        onClick: () => {
          void runAction(onScale);
        },
      });
    }
    if (onEditYaml) {
      actions.push({
        id: "edit-yaml",
        title: "Edit YAML",
        ariaLabel: `Edit ${getResourceLabel()} YAML`,
        icon: Pencil,
        onClick: () => {
          void runAction(onEditYaml);
        },
      });
    }
    if (onInvestigate) {
      actions.push({
        id: "investigate",
        title: "Investigate",
        ariaLabel: `Investigate ${getResourceLabel()}`,
        icon: Search,
        onClick: () => {
          void runAction(onInvestigate);
        },
      });
    }
    if (onCopyDescribe) {
      actions.push({
        id: "copy-describe",
        title: "Copy kubectl describe",
        ariaLabel: `Copy kubectl describe for ${getResourceLabel()}`,
        icon: ClipboardList,
        onClick: () => {
          void runAction(onCopyDescribe);
        },
      });
    }
    if (onRunDebugDescribe) {
      actions.push({
        id: "debug-describe",
        title: "Run debug describe",
        ariaLabel: `Run debug describe for ${getResourceLabel()}`,
        icon: Bug,
        onClick: () => {
          void runAction(onRunDebugDescribe);
        },
      });
    }
    if (onTrigger) {
      actions.push({
        id: "trigger",
        title: "Trigger now",
        ariaLabel: `Trigger ${getResourceLabel()} now`,
        icon: Play,
        onClick: () => {
          void runAction(onTrigger);
        },
      });
    }
    if (onToggleSuspend) {
      actions.push({
        id: "toggle-suspend",
        title: isScheduleSuspended() ? "Resume schedule" : "Suspend schedule",
        ariaLabel: `${isScheduleSuspended() ? "Resume" : "Suspend"} ${getResourceLabel()} schedule`,
        icon: Pause,
        onClick: () => {
          void runAction(onToggleSuspend);
        },
      });
    }
    if (onDownloadYaml) {
      actions.push({
        id: "download-yaml",
        title: "Download YAML",
        ariaLabel: `Download ${getResourceLabel()} YAML`,
        icon: FileDown,
        onClick: () => {
          void runAction(onDownloadYaml);
        },
      });
    }
    if (onRolloutStatus) {
      actions.push({
        id: "rollout-status",
        title: "Rollout status",
        ariaLabel: `Open rollout status for ${getResourceLabel()}`,
        icon: Clock3,
        onClick: () => {
          void runAction(onRolloutStatus);
        },
      });
    }
    if (onRolloutHistory) {
      actions.push({
        id: "rollout-history",
        title: "Rollout history",
        ariaLabel: `Open rollout history for ${getResourceLabel()}`,
        icon: ListTree,
        onClick: () => {
          void runAction(onRolloutHistory);
        },
      });
    }
    if (onRestart) {
      actions.push({
        id: "restart",
        title: "Rollout restart",
        ariaLabel: `Rollout restart ${getResourceLabel()}`,
        icon: RotateCcw,
        onClick: () => {
          void runAction(onRestart);
        },
      });
    }
    if (onDelete) {
      actions.push({
        id: "delete",
        title: "Delete",
        ariaLabel: `Delete ${getResourceLabel()}`,
        icon: Trash,
        destructive: true,
        onClick: () => {
          void runAction(onDelete);
        },
      });
    }

    return actions;
  }
</script>

{#if $isOpen && $selectedItem}
<DetailsSheetPortal open={$isOpen} onClose={closeDetails} closeAriaLabel={`Close ${getResourceLabel()} details`}>
      <div class="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div class="min-w-0 flex items-center gap-2">
          <Info class="h-4 w-4 shrink-0 text-muted-foreground" />
          <div class="truncate text-base font-semibold">{title}: {$selectedItem?.metadata?.name ?? "-"}</div>
        </div>
        <DetailsHeaderActions
          actions={getHeaderActions()}
          closeAriaLabel={`Close ${getResourceLabel()} details`}
          onClose={closeDetails}
        />
      </div>
      <div class="flex-1 overflow-y-auto p-4">
        <div class="text-xs text-muted-foreground">Namespace: {$selectedItem?.metadata?.namespace ?? "default"}</div>
        <h3 class="my-4 font-bold">Properties</h3>
        <DetailsMetadataGrid
          contextKey={`${$selectedItem?.metadata?.namespace ?? "default"}/${$selectedItem?.metadata?.name ?? "-"}`}
          fields={[
            { label: "Created", value: getCreatedLabel() },
            { label: "Name", value: $selectedItem?.metadata?.name ?? "-" },
            { label: "Namespace", value: $selectedItem?.metadata?.namespace ?? "default" },
          ]}
          labels={getLabelEntries()}
          annotations={getAnnotationEntries()}
        />
        <div class="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {#if getControlledByLabel() !== "-" && !isCronJobDetails()}
            <div class="rounded border p-3 sm:col-span-2">
              <div class="text-xs text-muted-foreground">Controlled By</div>
              <div>{getControlledByLabel()}</div>
            </div>
          {/if}
          {#if !isCronJobDetails()}
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Selector</div>
              {#if getSelectorLines().length === 0}
                <div>-</div>
              {:else}
                <div class="mt-1 space-y-1 text-xs">
                  {#each getSelectorLines() as line}
                    <div class="break-all">{line}</div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
          {#if !isCronJobDetails() && !isJobDetails()}
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Node Selector</div>
              {#if getNodeSelectorLines().length === 0}
                <div>-</div>
              {:else}
                <div class="mt-1 space-y-1 text-xs">
                  {#each getNodeSelectorLines() as line}
                    <div class="break-all">{line}</div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
          {#if !isCronJobDetails()}
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Images</div>
              <button
                type="button"
                class={`mt-1 inline-flex items-center gap-1 rounded px-1.5 py-1 text-left transition ${
                  showImagesDetails
                    ? "bg-sky-100/70 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                onclick={() => (showImagesDetails = !showImagesDetails)}
              >
                <span>{getImages().length} Images</span>
                {#if showImagesDetails}
                  <ChevronUp class="h-3.5 w-3.5 text-sky-700 dark:text-sky-300" />
                {:else}
                  <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
                {/if}
              </button>
              {#if showImagesDetails}
                <div class="mt-2 space-y-1 rounded border border-sky-200/60 bg-sky-50/70 p-2 text-xs dark:border-sky-500/30 dark:bg-sky-500/10">
                  {#if getImages().length === 0}
                    <div class="text-muted-foreground">No images.</div>
                  {:else}
                    {#each getImages() as image}
                      <div class="break-all">{image}</div>
                    {/each}
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
          {#if isCronJobDetails()}
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Schedule</div>
              <div>{getScheduleLabel()}</div>
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Active</div>
              <div>{getCronActiveCountLabel()}</div>
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Suspend</div>
              <div>{getSuspendLabel()}</div>
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Last schedule</div>
              <div>{getLastScheduleLabel()}</div>
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Next execution</div>
              <div>{getNextExecutionLabel()}</div>
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Time zone</div>
              <div>{getTimeZoneLabel()}</div>
            </div>
          {:else if isJobDetails()}
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Completions</div>
              <div>{getJobCompletionsLabel()}</div>
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Parallelism</div>
              <div>{getParallelismLabel()}</div>
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Pod Status</div>
              <div>{getPodStatusSummary()}</div>
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Conditions</div>
              <button
                type="button"
                class={`mt-1 inline-flex items-center gap-1 rounded px-1.5 py-1 text-left transition ${
                  showJobConditionsDetails
                    ? "bg-sky-100/70 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                onclick={() => (showJobConditionsDetails = !showJobConditionsDetails)}
              >
                <span>{getConditionSummary()}</span>
                {#if showJobConditionsDetails}
                  <ChevronUp class="h-3.5 w-3.5 text-sky-700 dark:text-sky-300" />
                {:else}
                  <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
                {/if}
              </button>
              {#if showJobConditionsDetails}
                <div class="mt-2 space-y-1 rounded border border-sky-200/60 bg-sky-50/70 p-2 text-xs dark:border-sky-500/30 dark:bg-sky-500/10">
                  {#if getConditionLines().length === 0}
                    <div class="text-muted-foreground">No conditions.</div>
                  {:else}
                    {#each getConditionLines() as line}
                      <div class="break-all">{line}</div>
                    {/each}
                  {/if}
                </div>
              {/if}
            </div>
          {:else if isReplicaSetDetails() || isStatefulSetDetails()}
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Replicas</div>
              <div>{getReplicasLabel()}</div>
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Pod Status</div>
              <div>{getPodStatusSummary()}</div>
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Pod Anti Affinities</div>
              <button
                type="button"
                class={`mt-1 inline-flex items-center gap-1 rounded px-1.5 py-1 text-left transition ${
                  showPodAntiAffinitiesDetails
                    ? "bg-sky-100/70 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                onclick={() => (showPodAntiAffinitiesDetails = !showPodAntiAffinitiesDetails)}
              >
                <span>{getPodAntiAffinityRulesLabel()}</span>
                {#if showPodAntiAffinitiesDetails}
                  <ChevronUp class="h-3.5 w-3.5 text-sky-700 dark:text-sky-300" />
                {:else}
                  <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
                {/if}
              </button>
              {#if showPodAntiAffinitiesDetails}
                <div class="mt-2 space-y-1 rounded border border-sky-200/60 bg-sky-50/70 p-2 text-xs dark:border-sky-500/30 dark:bg-sky-500/10">
                  {#if getPodAntiAffinityLines().length === 0}
                    <div class="text-muted-foreground">No pod anti affinity rules.</div>
                  {:else}
                    {#each getPodAntiAffinityLines() as line}
                      <div class="break-all">{line}</div>
                    {/each}
                  {/if}
                </div>
              {/if}
            </div>
          {:else}
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Status</div>
              <div class={`inline-flex items-center gap-2 font-medium ${getStatusToneClasses(getStatusLabel()).text}`}>
                <span class={`inline-block h-2.5 w-2.5 rounded-full ${getStatusToneClasses(getStatusLabel()).dot}`}></span>
                {getStatusLabel()}
              </div>
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Tolerations</div>
              <button
                type="button"
                class={`mt-1 inline-flex items-center gap-1 rounded px-1.5 py-1 text-left transition ${
                  showTolerationsDetails
                    ? "bg-sky-100/70 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                onclick={() => (showTolerationsDetails = !showTolerationsDetails)}
              >
                <span>{getTolerationsCountLabel()}</span>
                {#if showTolerationsDetails}
                  <ChevronUp class="h-3.5 w-3.5 text-sky-700 dark:text-sky-300" />
                {:else}
                  <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
                {/if}
              </button>
              {#if showTolerationsDetails}
                <div class="mt-2 space-y-1 rounded border border-sky-200/60 bg-sky-50/70 p-2 text-xs dark:border-sky-500/30 dark:bg-sky-500/10">
                  {#if getTolerationLines().length === 0}
                    <div class="text-muted-foreground">No tolerations.</div>
                  {:else}
                    {#each getTolerationLines() as line}
                      <div class="break-all">{line}</div>
                    {/each}
                  {/if}
                </div>
              {/if}
            </div>
            {#if !isReplicaSetDetails()}
              <div class="rounded border p-3">
                <div class="text-xs text-muted-foreground">Strategy Type</div>
                <div>{getStrategyType()}</div>
              </div>
            {/if}
            <div class="rounded border p-3 sm:col-span-2">
              <div class="text-xs text-muted-foreground">Conditions</div>
              <button
                type="button"
                class={`mt-1 inline-flex items-center gap-1 rounded px-1.5 py-1 text-left transition ${
                  showConditionsDetails
                    ? "bg-sky-100/70 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                onclick={() => (showConditionsDetails = !showConditionsDetails)}
              >
                <span>{getConditionLines().length} Conditions</span>
                {#if showConditionsDetails}
                  <ChevronUp class="h-3.5 w-3.5 text-sky-700 dark:text-sky-300" />
                {:else}
                  <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
                {/if}
              </button>
              {#if showConditionsDetails}
                <div class="mt-2 space-y-1 rounded border border-sky-200/60 bg-sky-50/70 p-2 text-xs dark:border-sky-500/30 dark:bg-sky-500/10">
                  {#if getConditionLines().length === 0}
                    <div class="text-muted-foreground">No conditions.</div>
                  {:else}
                    {#each getConditionLines() as line}
                      <div class="break-all">{line}</div>
                    {/each}
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        </div>
        {#if isStatefulSetDetails() || isReplicaSetDetails() || isJobDetails() || isCronJobDetails()}
          <ResourceTrafficChain
            {clusterId}
            resourceKind={isStatefulSetDetails() ? "StatefulSet" : isReplicaSetDetails() ? "ReplicaSet" : isJobDetails() ? "Job" : "CronJob"}
            resourceName={$selectedItem?.metadata?.name ?? ""}
            resourceNamespace={$selectedItem?.metadata?.namespace ?? "default"}
            raw={$selectedItem as unknown as Record<string, unknown>}
          />
        {/if}

        {#if !isCronJobDetails() && !isJobDetails() && !isReplicaSetDetails() && !isStatefulSetDetails() && !isNodeDetails()}
          <h3 class="my-4 font-bold">Spec</h3>
          <pre class="max-h-64 overflow-auto rounded-md bg-muted/40 p-3 text-xs">
{JSON.stringify($selectedItem?.spec ?? {}, null, 2)}
          </pre>
          <h3 class="my-4 font-bold">Status</h3>
          <pre class="max-h-64 overflow-auto rounded-md bg-muted/40 p-3 text-xs">
{JSON.stringify($selectedItem?.status ?? {}, null, 2)}
          </pre>
        {/if}
        {#if isCronJobDetails()}
          <h3 class="my-4 font-bold">Job History</h3>
          <div class="space-y-1 text-sm">
            {#if getCronJobHistoryRows().length === 0}
              <div class="rounded border p-3 text-muted-foreground">No jobs found.</div>
            {:else}
              {#each getCronJobHistoryRows() as row}
                <div class="grid grid-cols-1 gap-2 rounded border p-2 sm:grid-cols-[3fr_1fr]">
                  <div class="break-all">{row.name}</div>
                  <div class={`inline-flex items-center gap-2 ${getStatusToneClasses(row.status).text}`}>
                    <span class={`inline-block h-2 w-2 rounded-full ${getStatusToneClasses(row.status).dot}`}></span>
                    {row.status}
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        {:else if !isJobDetails()}
          <h3 class="my-4 font-bold">Pods</h3>
          <div class="space-y-1 text-sm">
            {#if getPodsFromStatus().length === 0}
              <div class="rounded border p-3 text-muted-foreground">No pods found.</div>
            {:else}
              {#each getPodsFromStatus() as pod}
                <div class="grid grid-cols-1 gap-2 rounded border p-2 sm:grid-cols-[2fr_2fr_1fr_1fr_1fr_1fr_1fr]">
                  <div>{pod.name}</div>
                  <div>{pod.node}</div>
                  <div>{pod.namespace}</div>
                  <div>{pod.ready}</div>
                  <div>{pod.cpu}</div>
                  <div>{pod.memory}</div>
                  <div class={`inline-flex items-center gap-2 ${getStatusToneClasses(pod.status).text}`}>
                    <span class={`inline-block h-2 w-2 rounded-full ${getStatusToneClasses(pod.status).dot}`}></span>
                    {pod.status}
                  </div>
                </div>
              {/each}
            {/if}
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

        <h3 class="my-4 font-bold">Events</h3>
        <DetailsEventsList
          {events}
          loading={eventsLoading}
          error={eventsError}
          emptyText="No events found."
        />
      </div>
</DetailsSheetPortal>
{/if}
