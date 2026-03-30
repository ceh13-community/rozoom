<script lang="ts">
  import ActionNotificationBar from "$shared/ui/action-notification-bar.svelte";
  import { onDestroy, onMount } from "svelte";
  import { resolvePageClusterName, type PageData } from "$entities/cluster";
  import { runDebugDescribe } from "$features/resource-debug-runtime";
  import { confirmAction } from "$shared/lib/confirm-action";
  import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
  import {
    markConfigurationSyncError,
    markConfigurationSyncLoading,
    markConfigurationSyncSuccess,
    resetConfigurationSyncStatus,
    setConfigurationSyncEnabled,
  } from "$features/check-health";
  import { exportCsvArtifact } from "$shared/lib/text-export";
  import { fetchNamespacedSnapshotItems } from "../common/namespaced-snapshot";
  import {
    buildKubectlDescribeCommand,
    buildKubectlGetYamlCommand,
  } from "../common/kubectl-command-builder";
  import { Button, SortingButton } from "$shared/ui/button";
  import { Input } from "$shared/ui/input";
  import * as Table from "$shared/ui/table";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import FileDown from "@lucide/svelte/icons/file-down";
  import { selectedNamespace } from "$features/namespace-management";
  import ResourceActionsMenu, { type ResourceActionItem } from "../common/resource-actions-menu.svelte";
  import FolderSearch from "@lucide/svelte/icons/folder-search";
  import CustomResourcesBulkActions from "./custom-resources-bulk-actions.svelte";
  import ResourceSelectionCheckbox from "../common/resource-selection-checkbox.svelte";
  import WorkloadSelectionBar from "../common/workload-selection-bar.svelte";
  import TableChecklistDropdown from "../table-checklist-dropdown.svelte";
  import CustomResourcesDetailsSheet from "./custom-resources-details-sheet.svelte";
  import ResourceYamlWorkbenchPanel, {
    type ResourceYamlWorkbenchRequest,
  } from "../common/resource-yaml-workbench-panel.svelte";

  type CrWorkbenchTarget = {
    title: string; loadedLabel: string; errorLabel: string; copyLabel: string;
    resource: string; name: string; namespace?: string; namespaceScoped: boolean;
  };
  import {
    createCustomResourceRows,
    filterCustomResourceRows,
  } from "./model/custom-resources-row";
  import {
    createCustomResourceInstanceRows,
    type CustomResourceInstanceRow,
  } from "./model/custom-resource-instance-row";
  import type { CustomResourceRow } from "./model/custom-resources-row-adapter";
  import TableToolbarShell from "../table-toolbar-shell.svelte";
  import ResourceSummaryStrip from "../common/resource-summary-strip.svelte";
  import SectionRuntimeStatus from "../common/section-runtime-status.svelte";
  import WatcherToolbarControls from "../watcher-toolbar-controls.svelte";

  type GenericItem = Record<string, unknown>;
  type ColumnId = "name" | "group" | "version" | "scope" | "resource" | "summary" | "age";
  type ColumnConfig = {
    id: ColumnId;
    label: string;
    visible: boolean;
  };
  type WatcherSettings = {
    enabled: boolean;
    refreshSeconds: number;
  };

  const WATCHER_SETTINGS_PREFIX = "dashboard.custom-resources.watcher.settings.v1";
  const DEFAULT_WATCHER_SETTINGS: WatcherSettings = {
    enabled: true,
    refreshSeconds: 30,
  };

  interface Props {
    data: PageData & {
      items?: GenericItem[];
      workloadKey?: "customresourcedefinitions" | null;
    };
  }

  let { data }: Props = $props();
  let query = $state("");
  let selectedIds = $state(new Set<string>());
  let deletingIds = $state(new Set<string>());
  let selectedRow = $state<CustomResourceRow | null>(null);
  let detailsOpen = $state(false);
  import { notifySuccess, notifyError, type ActionNotification } from "$shared/lib/action-notification";
  let actionNotification = $state<ActionNotification>(null);
  
  let workbenchRequest = $state<ResourceYamlWorkbenchRequest>(null);
  let workbenchRequestToken = 0;
  let activeInstancesDefinition = $state<CustomResourceRow | null>(null);
  let instanceRows = $state<CustomResourceInstanceRow[]>([]);
  let instancesLoading = $state(false);
  let instancesError = $state<string | null>(null);
  let deletingInstanceId = $state<string | null>(null);
  let watcherEnabled = $state(DEFAULT_WATCHER_SETTINGS.enabled);
  let watcherRefreshSeconds = $state(DEFAULT_WATCHER_SETTINGS.refreshSeconds);
  let watcherSettingsLoadedCluster = $state<string | null>(null);
  let routeSnapshotSeedKey = $state<string | null>(null);
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshState = $state<"idle" | "loading" | "error">("idle");
  let refreshError = $state<string | null>(null);
  let lastUpdatedAt = $state<number | null>(null);
  let hasWatcherRefreshCompleted = $state(false);
  let runtimeItems = $state<GenericItem[]>([]);
  let columnConfigs = $state<ColumnConfig[]>([
    { id: "name", label: "Name", visible: true },
    { id: "group", label: "Group", visible: true },
    { id: "version", label: "Version", visible: true },
    { id: "scope", label: "Scope", visible: true },
    { id: "resource", label: "Resource", visible: true },
    { id: "summary", label: "Summary", visible: true },
    { id: "age", label: "Age", visible: true },
  ]);
  let sortBy = $state<"problemScore" | "name" | "group" | "version" | "scope" | "resource" | "summary" | "age">("problemScore");
  let sortDirection = $state<"asc" | "desc">("desc");
  let instanceSortBy = $state<"name" | "namespace" | "status" | "age">("name");
  let instanceSortDirection = $state<"asc" | "desc">("asc");

  const sourceItems = $derived(runtimeItems);
  const rows = $derived.by(() => createCustomResourceRows(sourceItems));
  function compareText(left: string, right: string) {
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  }

  function getTimestamp(value: unknown) {
    const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function getCreationTimestamp(item: Record<string, unknown>) {
    const metadata = item.metadata;
    if (!metadata || typeof metadata !== "object") return "";
    return typeof (metadata as Record<string, unknown>).creationTimestamp === "string"
      ? ((metadata as Record<string, unknown>).creationTimestamp as string)
      : "";
  }

  function toggleSort(column: typeof sortBy) {
    if (sortBy !== column) {
      sortBy = column;
      sortDirection = "asc";
      return;
    }
    sortDirection = sortDirection === "asc" ? "desc" : "asc";
  }

  function toggleInstanceSort(column: typeof instanceSortBy) {
    if (instanceSortBy !== column) {
      instanceSortBy = column;
      instanceSortDirection = "asc";
      return;
    }
    instanceSortDirection = instanceSortDirection === "asc" ? "desc" : "asc";
  }

  const filteredRows = $derived.by(() => {
    const baseRows = filterCustomResourceRows(rows, query);
    return [...baseRows].sort((left, right) => {
      const leftValue =
        sortBy === "problemScore"
          ? left.problemScore
          : sortBy === "name"
            ? left.name
            : sortBy === "group"
              ? left.group
              : sortBy === "version"
                ? left.version
                : sortBy === "scope"
                  ? left.scope
                  : sortBy === "resource"
                    ? left.resource
                    : sortBy === "summary"
                      ? left.summary
                      : getTimestamp(getCreationTimestamp(left.raw));
      const rightValue =
        sortBy === "problemScore"
          ? right.problemScore
          : sortBy === "name"
            ? right.name
            : sortBy === "group"
              ? right.group
              : sortBy === "version"
                ? right.version
                : sortBy === "scope"
                  ? right.scope
                  : sortBy === "resource"
                    ? right.resource
                    : sortBy === "summary"
                      ? right.summary
                      : getTimestamp(getCreationTimestamp(right.raw));
      const result =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : compareText(String(leftValue), String(rightValue));
      return sortDirection === "asc" ? result : result * -1;
    });
  });
  const sortedInstanceRows = $derived.by(() =>
    [...instanceRows].sort((left, right) => {
      const leftValue =
        instanceSortBy === "name"
          ? left.name
          : instanceSortBy === "namespace"
            ? left.namespace
            : instanceSortBy === "status"
              ? left.status
              : getTimestamp(getCreationTimestamp(left.raw));
      const rightValue =
        instanceSortBy === "name"
          ? right.name
          : instanceSortBy === "namespace"
            ? right.namespace
            : instanceSortBy === "status"
              ? right.status
              : getTimestamp(getCreationTimestamp(right.raw));
      const result =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : compareText(String(leftValue), String(rightValue));
      return instanceSortDirection === "asc" ? result : result * -1;
    }),
  );
  const availableIds = $derived.by(() => filteredRows.map((row) => row.uid));
  const selectedRows = $derived.by(() => filteredRows.filter((row) => selectedIds.has(row.uid)));
  const bulkMode = $derived((selectedRows.length === 1 ? "single" : "multi") as "single" | "multi");
  const areAllSelected = $derived(
    availableIds.length > 0 && availableIds.every((id) => selectedIds.has(id)),
  );
  const runtimeSourceState = $derived.by(() => {
    if (!watcherEnabled) return "paused";
    if (refreshError && sourceItems.length > 0) return "cached";
    if (refreshError) return "error";
    if (refreshState === "loading" && sourceItems.length > 0) return "cached";
    if (hasWatcherRefreshCompleted) return "live";
    if (sourceItems.length > 0) return "cached";
    if (refreshState === "loading") return "idle";
    return "idle";
  });
  const runtimeDetail = $derived.by(() => {
    if (!watcherEnabled) {
      return "Watcher paused. Route snapshot stays visible until you resume or refresh.";
    }
    if (refreshState === "loading") {
      return "Background CRD refresh in flight.";
    }
    if (refreshError) {
      return "Showing last known CRD snapshot while refresh is degraded.";
    }
    if (hasWatcherRefreshCompleted) {
      return "Active CRD snapshot refresh is healthy.";
    }
    return "Route-scoped CRD snapshot loaded. First polling refresh will promote it to live.";
  });
  const runtimeReason = $derived.by(() => {
    if (refreshError) {
      return refreshError;
    }
    return "CRDs are cluster-scoped. Instance browsing uses on-demand fetches with the current namespace filter where applicable.";
  });

  function clampWatcherRefreshSeconds(value: number) {
    return Math.min(600, Math.max(5, Math.round(value)));
  }

  function getWatcherSettingsKey(clusterId: string) {
    return `${WATCHER_SETTINGS_PREFIX}:${clusterId}`;
  }

  function loadWatcherSettings(clusterId: string): WatcherSettings {
    if (typeof window === "undefined") return DEFAULT_WATCHER_SETTINGS;
    try {
      const raw = window.localStorage.getItem(getWatcherSettingsKey(clusterId));
      if (!raw) return DEFAULT_WATCHER_SETTINGS;
      const parsed = JSON.parse(raw) as Partial<WatcherSettings> | null;
      return {
        enabled: typeof parsed?.enabled === "boolean" ? parsed.enabled : DEFAULT_WATCHER_SETTINGS.enabled,
        refreshSeconds:
          typeof parsed?.refreshSeconds === "number"
            ? clampWatcherRefreshSeconds(parsed.refreshSeconds)
            : DEFAULT_WATCHER_SETTINGS.refreshSeconds,
      };
    } catch {
      return DEFAULT_WATCHER_SETTINGS;
    }
  }

  function persistWatcherSettings() {
    if (typeof window === "undefined" || !data?.slug) return;
    window.localStorage.setItem(
      getWatcherSettingsKey(data.slug),
      JSON.stringify({
        enabled: watcherEnabled,
        refreshSeconds: watcherRefreshSeconds,
      }),
    );
  }

  function stopRefreshTimer() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  }

  function scheduleRefresh() {
    stopRefreshTimer();
    if (!watcherEnabled || typeof window === "undefined") return;
    if (document.visibilityState === "hidden") return;
    refreshTimer = setTimeout(() => {
      void refreshDefinitions();
    }, watcherRefreshSeconds * 1000);
  }

  async function refreshDefinitions() {
    if (!data?.slug) return;
    refreshState = "loading";
    refreshError = null;
    setConfigurationSyncEnabled(data.slug, "customresourcedefinitions", watcherEnabled);
    markConfigurationSyncLoading(data.slug, "customresourcedefinitions");
    try {
      const response = await kubectlRawArgsFront(["get", "customresourcedefinitions", "-o", "json"], {
        clusterId: data.slug,
      });
      if (response.errors) {
        throw new Error(response.errors);
      }
      const parsed = JSON.parse(response.output || "{}") as { items?: GenericItem[] };
      runtimeItems = Array.isArray(parsed.items) ? parsed.items : [];
      lastUpdatedAt = Date.now();
      hasWatcherRefreshCompleted = true;
      refreshState = "idle";
      markConfigurationSyncSuccess(data.slug, "customresourcedefinitions");
    } catch (error) {
      refreshError =
        error instanceof Error ? error.message : "Failed to refresh custom resource definitions.";
      refreshState = "error";
      markConfigurationSyncError(data.slug, "customresourcedefinitions", refreshError);
    } finally {
      scheduleRefresh();
    }
  }

  function applyWatcherMode() {
    stopRefreshTimer();
    if (!watcherEnabled) return;
    void refreshDefinitions();
  }

  function toggleWatcher() {
    watcherEnabled = !watcherEnabled;
    persistWatcherSettings();
    if (!watcherEnabled) {
      if (data?.slug) {
        setConfigurationSyncEnabled(data.slug, "customresourcedefinitions", false);
      }
      stopRefreshTimer();
      refreshState = "idle";
      return;
    }
    applyWatcherMode();
  }

  function setWatcherRefresh(value: number) {
    watcherRefreshSeconds = clampWatcherRefreshSeconds(value);
    persistWatcherSettings();
    if (watcherEnabled) {
      applyWatcherMode();
    }
  }

  function resetWatcherSettings() {
    watcherEnabled = DEFAULT_WATCHER_SETTINGS.enabled;
    watcherRefreshSeconds = DEFAULT_WATCHER_SETTINGS.refreshSeconds;
    persistWatcherSettings();
    applyWatcherMode();
  }

  function pruneSelection() {
    const next = new Set([...selectedIds].filter((id) => availableIds.includes(id)));
    const changed =
      next.size !== selectedIds.size || [...next].some((id) => !selectedIds.has(id));
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

  function getColumnEntries() {
    return columnConfigs.map((column) => ({
      id: column.id,
      label: column.label,
      checked: column.visible,
    }));
  }

  function toggleColumnVisibility(columnId: string, checked: boolean) {
    columnConfigs = columnConfigs.map((column) =>
      column.id === columnId ? { ...column, visible: checked } : column,
    );
  }

  function showAllColumns() {
    columnConfigs = columnConfigs.map((column) => ({ ...column, visible: true }));
  }

  function hideAllColumns() {
    columnConfigs = columnConfigs.map((column) =>
      column.id === "name" ? column : { ...column, visible: false },
    );
  }

  function isColumnVisible(columnId: ColumnId) {
    return columnConfigs.find((column) => column.id === columnId)?.visible ?? true;
  }

  function openDetails(row: CustomResourceRow) {
    selectedRow = row;
    detailsOpen = true;
  }

  function openYamlWorkbench(row: CustomResourceRow) {
    const t = getDefinitionTarget(row);
    workbenchRequestToken += 1;
    workbenchRequest = {
      token: workbenchRequestToken,
      kind: "yaml",
      name: t.name,
      resource: t.resource,
      namespace: t.namespace,
      namespaceScoped: t.namespaceScoped,
      title: t.title,
      copyLabel: t.copyLabel,
      loadedLabel: t.loadedLabel,
      errorLabel: t.errorLabel,
    };
  }

  function getDefinitionTarget(row: CustomResourceRow): CrWorkbenchTarget {
    return {
      title: "Custom Resource Definition YAML",
      loadedLabel: `Loaded YAML for ${row.name}.`,
      errorLabel: "Failed to load custom resource definition YAML.",
      copyLabel: "Copied CRD YAML.",
      resource: "crd",
      name: row.name,
      namespaceScoped: false,
    };
  }

  function getInstanceResource(row: CustomResourceRow) {
    return `${row.resource}.${row.group}`;
  }

  function getInstanceTarget(definition: CustomResourceRow, row: CustomResourceInstanceRow): CrWorkbenchTarget {
    const namespaceScoped = definition.scope.toLowerCase() === "namespaced";
    return {
      title: `${row.raw.kind ?? definition.resource} YAML`,
      loadedLabel: `Loaded YAML for ${row.name}.`,
      errorLabel: "Failed to load custom resource YAML.",
      copyLabel: "Copied custom resource YAML.",
      resource: getInstanceResource(definition),
      name: row.name,
      namespace: namespaceScoped ? row.namespace : undefined,
      namespaceScoped,
    };
  }

  async function copyText(value: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(value);
  }

  async function copyGetYaml(row: CustomResourceRow) {
    await copyText(buildKubectlGetYamlCommand(getDefinitionTarget(row)));
    actionNotification = notifySuccess(`Copied kubectl get -o yaml for ${row.name}.`);
  }

  async function copyDescribe(row: CustomResourceRow) {
    await copyText(buildKubectlDescribeCommand(getDefinitionTarget(row)));
    actionNotification = notifySuccess(`Copied kubectl describe for ${row.name}.`);
  }

  function openDebugDescribe(row: CustomResourceRow) {
    const target = getDefinitionTarget(row);
    runDebugDescribe({
      clusterId: data.slug,
      resource: target.resource,
      name: target.name,
      title: `Describe crd ${row.name}`,
    });
    actionNotification = notifySuccess(`Opened debug describe for ${row.name}.`);
  }

  async function loadInstances(row: CustomResourceRow) {
    if (!data.slug) return;
    activeInstancesDefinition = row;
    instancesLoading = true;
    instancesError = null;
    try {
      const resource = getInstanceResource(row);
      const items =
        row.scope.toLowerCase() === "namespaced"
          ? await fetchNamespacedSnapshotItems<GenericItem>({
              clusterId: data.slug,
              selectedNamespace: $selectedNamespace,
              resource,
              errorMessage: `Failed to fetch instances for ${resource}.`,
            })
          : await (async () => {
              const response = await kubectlRawArgsFront(["get", resource, "-o", "json"], {
                clusterId: data.slug,
              });
              if (response.errors) throw new Error(response.errors);
              const parsed = JSON.parse(response.output || "{}") as { items?: GenericItem[] };
              return Array.isArray(parsed.items) ? parsed.items : [];
            })();
      instanceRows = createCustomResourceInstanceRows(items);
      actionNotification = notifySuccess(`Loaded ${items.length} instance(s) for ${row.resource}.${row.group}.`);
    } catch (error) {
      instanceRows = [];
      instancesError = error instanceof Error ? error.message : "Failed to load custom resource instances.";
    } finally {
      instancesLoading = false;
    }
  }

  function openInstanceYaml(definition: CustomResourceRow, row: CustomResourceInstanceRow) {
    const t = getInstanceTarget(definition, row);
    workbenchRequestToken += 1;
    workbenchRequest = {
      token: workbenchRequestToken,
      kind: "yaml",
      name: t.name,
      resource: t.resource,
      namespace: t.namespace,
      namespaceScoped: t.namespaceScoped,
      title: t.title,
      copyLabel: t.copyLabel,
      loadedLabel: t.loadedLabel,
      errorLabel: t.errorLabel,
    };
  }

  async function copyInstanceYaml(definition: CustomResourceRow, row: CustomResourceInstanceRow) {
    await copyText(buildKubectlGetYamlCommand(getInstanceTarget(definition, row)));
    actionNotification = notifySuccess(`Copied kubectl get -o yaml for ${row.name}.`);
  }

  async function copyInstanceDescribe(definition: CustomResourceRow, row: CustomResourceInstanceRow) {
    await copyText(buildKubectlDescribeCommand(getInstanceTarget(definition, row)));
    actionNotification = notifySuccess(`Copied kubectl describe for ${row.name}.`);
  }

  function runInstanceDebugDescribe(definition: CustomResourceRow, row: CustomResourceInstanceRow) {
    const target = getInstanceTarget(definition, row);
    runDebugDescribe({
      clusterId: data.slug,
      resource: target.resource,
      name: target.name,
      namespace: target.namespaceScoped ? target.namespace : undefined,
      title: `Describe ${(row.raw.kind as string | undefined) ?? definition.resource} ${row.namespace}/${row.name}`,
    });
    actionNotification = notifySuccess(`Opened debug describe for ${row.name}.`);
  }

  async function deleteInstance(definition: CustomResourceRow, row: CustomResourceInstanceRow) {
    if (!data.slug) return;
    const confirmed = await confirmAction(
      `Delete ${row.name} from ${definition.resource}.${definition.group}?`,
      "Confirm delete",
    );
    if (!confirmed) return;
    deletingInstanceId = row.uid;
    instancesError = null;
    try {
      const target = getInstanceTarget(definition, row);
      const response = await kubectlRawArgsFront(
        [
          "delete",
          target.resource,
          target.name,
          ...(target.namespaceScoped && target.namespace ? ["-n", target.namespace] : []),
        ],
        { clusterId: data.slug },
      );
      if (response.errors) throw new Error(response.errors);
      actionNotification = notifySuccess(`Deleted ${row.name}.`);
      await loadInstances(definition);
    } catch (error) {
      instancesError = error instanceof Error ? error.message : "Failed to delete custom resource.";
    } finally {
      deletingInstanceId = null;
    }
  }

  function requireActiveInstancesDefinition() {
    if (!activeInstancesDefinition) {
      throw new Error("Custom resource definition is required.");
    }
    return activeInstancesDefinition;
  }

  function setDeleting(id: string, next: boolean) {
    const updated = new Set(deletingIds);
    if (next) updated.add(id);
    else updated.delete(id);
    deletingIds = updated;
  }

  function buildRouteSnapshotSeed(clusterId: string | null, items: GenericItem[]) {
    const fingerprint = items
      .map((item) => {
        const metadata = item.metadata as
          | {
              uid?: string;
              resourceVersion?: string;
              generation?: string | number;
              name?: string;
            }
          | undefined;
        return [
          metadata?.uid ?? "",
          metadata?.resourceVersion ?? "",
          metadata?.generation ?? "",
          metadata?.name ?? "",
        ].join(":");
      })
      .join("|");
    return `${clusterId ?? "none"}:${fingerprint}`;
  }

  async function deleteRows(rowsToDelete: CustomResourceRow[]) {
    if (!data.slug || rowsToDelete.length === 0) return;
    const confirmed = await confirmAction(
      `Delete ${rowsToDelete.length} custom resource definition(s)?`,
      "Confirm delete",
    );
    if (!confirmed) return;

    actionNotification = null;
    for (const row of rowsToDelete) {
      setDeleting(row.uid, true);
      try {
        const response = await kubectlRawArgsFront(["delete", "crd", row.name], {
          clusterId: data.slug,
        });
        if (response.errors) {
          throw new Error(response.errors);
        }
      } catch (error) {
        actionNotification = notifyError(error instanceof Error ? error.message : "Failed to delete custom resource definition.");
        return;
      } finally {
        setDeleting(row.uid, false);
      }
    }

    actionNotification = notifySuccess(`Deleted ${rowsToDelete.length} custom resource definition(s).`);
    selectedIds = new Set();
    detailsOpen = false;
  }

  async function downloadCsv() {
    const lines = [
      ["name", "group", "version", "scope", "resource", "summary", "age"].join(","),
      ...filteredRows.map((row) =>
        [row.name, row.group, row.version, row.scope, row.resource, row.summary, row.age]
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(","),
      ),
    ];
    const result = await exportCsvArtifact({
      filename: "custom-resource-definitions.csv",
      csv: lines.join("\n"),
    });
    actionNotification = notifySuccess(`CSV exported: ${result.pathHint} (${filteredRows.length} rows).`);
  }

  $effect(() => {
    pruneSelection();
  });

  $effect(() => {
    const clusterId = data?.slug ?? null;
    const nextItems = (Array.isArray(data?.items) ? data.items : []) as GenericItem[];
    const seedKey = buildRouteSnapshotSeed(clusterId, nextItems);
    if (routeSnapshotSeedKey === seedKey) return;
    routeSnapshotSeedKey = seedKey;
    runtimeItems = nextItems;
    lastUpdatedAt = Date.now();
    hasWatcherRefreshCompleted = false;
    refreshError = null;
    refreshState = "idle";
  });

  $effect(() => {
    const clusterId = data?.slug ?? null;
    if (!clusterId) return;
    if (watcherSettingsLoadedCluster === clusterId) return;
    const settings = loadWatcherSettings(clusterId);
    watcherEnabled = settings.enabled;
    watcherRefreshSeconds = settings.refreshSeconds;
    watcherSettingsLoadedCluster = clusterId;
    setConfigurationSyncEnabled(clusterId, "customresourcedefinitions", watcherEnabled);
    applyWatcherMode();
  });

  onMount(() => {
    const handleVisibility = () => {
      if (!watcherEnabled) return;
      if (document.visibilityState === "visible") {
        applyWatcherMode();
      } else {
        stopRefreshTimer();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  });

  onDestroy(() => {
    if (data?.slug) {
      setConfigurationSyncEnabled(data.slug, "customresourcedefinitions", false);
      resetConfigurationSyncStatus(data.slug, "customresourcedefinitions");
    }
    stopRefreshTimer();
  });
</script>

<div class="grid gap-4">
  <ActionNotificationBar notification={actionNotification} onDismiss={() => { actionNotification = null; }} />

  <ResourceSummaryStrip
    items={[
      { label: "Cluster", value: resolvePageClusterName(data), tone: "foreground" },
      { label: "Scope", value: "Cluster-scoped" },
      { label: "Custom Resource Definitions", value: filteredRows.length },
      { label: "Sync", value: runtimeSourceState },
    ]}
    trailingItem={{ label: "View", value: "Table", valueClass: "text-foreground" }}
  />
  <SectionRuntimeStatus
    sectionLabel="Custom Resource Definitions Runtime Status"
    profileLabel="Balanced profile"
    sourceState={runtimeSourceState}
    mode={watcherEnabled ? "poll" : "manual"}
    budgetSummary={`sync ${watcherRefreshSeconds}s`}
    detail={runtimeDetail}
    secondaryActionLabel="Update"
    secondaryActionAriaLabel="Refresh custom resource definitions runtime section"
    secondaryActionLoading={refreshState === "loading"}
    onSecondaryAction={() => void refreshDefinitions()}
    reason={runtimeReason}
    actionLabel={watcherEnabled ? "Pause section" : "Resume section"}
    actionAriaLabel={watcherEnabled
      ? "Pause custom resource definitions runtime section"
      : "Resume custom resource definitions runtime section"}
    onAction={toggleWatcher}
  />

  <TableToolbarShell>
    {#snippet children()}
      <Input
        class="w-full max-w-xl"
        placeholder="Filter custom resource definitions..."
        value={query}
        oninput={(event) => {
          query = (event.currentTarget as HTMLInputElement).value;
        }}
      />
    {/snippet}
    {#snippet actions()}
      <TableChecklistDropdown
        label="Columns"
        entries={getColumnEntries()}
        onToggle={toggleColumnVisibility}
        onSelectAll={showAllColumns}
        onClearAll={hideAllColumns}
      />
      <Button
        variant="outline"
        size="sm"
        onclick={downloadCsv}
        title="Download CSV"
        aria-label="Download CSV"
      >
        <FileDown class="mr-1 h-4 w-4" />
        Download CSV
      </Button>
      <WatcherToolbarControls
        {watcherEnabled}
        watcherRefreshSeconds={watcherRefreshSeconds}
        onToggleWatcher={toggleWatcher}
        onWatcherRefreshSecondsChange={setWatcherRefresh}
        onResetWatcherSettings={resetWatcherSettings}
      />
    {/snippet}
  </TableToolbarShell>

  {#if selectedRows.length > 0}
    <WorkloadSelectionBar count={selectedRows.length}>
      {#snippet children()}
      <CustomResourcesBulkActions
        mode={bulkMode}
        disabled={selectedRows.length === 0}
        onShowDetails={() => {
          const row = selectedRows[0];
          if (!row) return;
          openDetails(row);
        }}
        onOpenYaml={() => {
          const row = selectedRows[0];
          if (!row) return;
          openYamlWorkbench(row);
        }}
        onBrowseInstances={() => {
          const row = selectedRows[0];
          if (!row) return;
          void loadInstances(row);
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
      <Button variant="outline" size="sm" onclick={() => {
        selectedIds = new Set();
      }}>Clear</Button>
      {/snippet}
    </WorkloadSelectionBar>
  {/if}

  <TableSurface>
    <Table.Table class="table-fixed">
      <Table.TableCaption>Custom Resource Definitions</Table.TableCaption>
      <Table.TableHeader>
        <Table.TableRow>
          <Table.TableHead class="w-10">
            <ResourceSelectionCheckbox
              checked={areAllSelected}
              label="Select all custom resource definitions"
              onToggle={toggleAll}
            />
          </Table.TableHead>
          <Table.TableHead class="w-20">
            <span class="text-[11px] uppercase tracking-wide">Actions</span>
          </Table.TableHead>
          {#if isColumnVisible("name")}
            <Table.TableHead class="w-[22%]">
              <SortingButton label="Name" onclick={() => toggleSort("name")} />
            </Table.TableHead>
          {/if}
          {#if isColumnVisible("group")}
            <Table.TableHead class="w-[18%]">
              <SortingButton label="Group" onclick={() => toggleSort("group")} />
            </Table.TableHead>
          {/if}
          {#if isColumnVisible("version")}
            <Table.TableHead class="w-[11%]">
              <SortingButton label="Version" onclick={() => toggleSort("version")} />
            </Table.TableHead>
          {/if}
          {#if isColumnVisible("scope")}
            <Table.TableHead class="w-[12%]">
              <SortingButton label="Scope" onclick={() => toggleSort("scope")} />
            </Table.TableHead>
          {/if}
          {#if isColumnVisible("resource")}
            <Table.TableHead class="w-[14%]">
              <SortingButton label="Resource" onclick={() => toggleSort("resource")} />
            </Table.TableHead>
          {/if}
          {#if isColumnVisible("summary")}
            <Table.TableHead class="w-[23%]">
              <SortingButton label="Summary" onclick={() => toggleSort("summary")} />
            </Table.TableHead>
          {/if}
          {#if isColumnVisible("age")}
            <Table.TableHead class="w-[10%]">
              <SortingButton label="Age" onclick={() => toggleSort("age")} />
            </Table.TableHead>
          {/if}
        </Table.TableRow>
      </Table.TableHeader>
      <Table.TableBody>
        {#if filteredRows.length === 0}
          <Table.TableRow>
            <Table.TableCell
              colspan={2 + columnConfigs.filter((column) => column.visible).length}
              class="text-center text-sm text-muted-foreground"
            >
              No results for the current filter.
            </Table.TableCell>
          </Table.TableRow>
        {:else}
          {#each filteredRows as row (row.uid)}
            <Table.TableRow
              class={selectedIds.has(row.uid) ? "bg-muted/30" : ""}
              role="button"
              tabindex={0}
              onclick={() => openDetails(row)}
              onkeydown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openDetails(row);
                }
              }}
            >
              <Table.TableCell>
                <ResourceSelectionCheckbox
                  checked={selectedIds.has(row.uid)}
                  label={`Select custom resource definition ${row.name}`}
                  stopPropagation={true}
                  onToggle={(next) => toggleSelection(row.uid, next)}
                />
              </Table.TableCell>
              <Table.TableCell>
                <ResourceActionsMenu
                  name={row.name}
                  isBusy={deletingIds.has(row.uid)}
                  onShowDetails={() => openDetails(row)}
                  onEditYaml={() => { openYamlWorkbench(row); }}
                  onCopyKubectlGetYaml={() => { void copyGetYaml(row); }}
                  onCopyDescribe={() => { void copyDescribe(row); }}
                  onRunDebugDescribe={() => { openDebugDescribe(row); }}
                  onDelete={() => { void deleteRows([row]); }}
                  extraItems={[{ id: "browse-instances", label: "Browse instances", icon: FolderSearch, action: () => { void loadInstances(row); } }]}
                />
              </Table.TableCell>
              {#if isColumnVisible("name")}
                <Table.TableCell class="min-w-0 truncate font-medium text-foreground">{row.name}</Table.TableCell>
              {/if}
              {#if isColumnVisible("group")}
                <Table.TableCell class="min-w-0 truncate text-muted-foreground">{row.group}</Table.TableCell>
              {/if}
              {#if isColumnVisible("version")}
                <Table.TableCell class="min-w-0 truncate text-muted-foreground">{row.version}</Table.TableCell>
              {/if}
              {#if isColumnVisible("scope")}
                <Table.TableCell class="min-w-0 truncate text-muted-foreground">{row.scope}</Table.TableCell>
              {/if}
              {#if isColumnVisible("resource")}
                <Table.TableCell class="min-w-0 truncate text-muted-foreground">{row.resource}</Table.TableCell>
              {/if}
              {#if isColumnVisible("summary")}
                <Table.TableCell class="min-w-0 truncate text-muted-foreground">{row.summary}</Table.TableCell>
              {/if}
              {#if isColumnVisible("age")}
                <Table.TableCell class="min-w-0 truncate text-muted-foreground">{row.age}</Table.TableCell>
              {/if}
            </Table.TableRow>
          {/each}
        {/if}
      </Table.TableBody>
    </Table.Table>
  </TableSurface>

  {#if activeInstancesDefinition}
    <section class="rounded-lg border border-border/60 bg-background/40">
      <div class="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div>
          <div class="text-sm font-semibold text-foreground">
            Instances for {activeInstancesDefinition.resource}.{activeInstancesDefinition.group}
          </div>
          <div class="text-xs text-muted-foreground">
            Scope: {activeInstancesDefinition.scope}. Namespace filter: {$selectedNamespace || "all namespaces"}.
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            loading={instancesLoading}
            loadingLabel="Refreshing"
            onclick={() => {
              if (!activeInstancesDefinition) return;
              void loadInstances(activeInstancesDefinition);
            }}
          >
            Refresh instances
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onclick={() => {
              activeInstancesDefinition = null;
              instanceRows = [];
              instancesError = null;
            }}
          >
            Close
          </Button>
        </div>
      </div>

      {#if instancesError}
        <div class="border-b border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {instancesError}
        </div>
      {/if}

      <div class="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_auto] gap-3 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <SortingButton label="Name" onclick={() => toggleInstanceSort("name")} />
        <SortingButton label="Namespace" onclick={() => toggleInstanceSort("namespace")} />
        <SortingButton label="Status" onclick={() => toggleInstanceSort("status")} />
        <SortingButton label="Age" onclick={() => toggleInstanceSort("age")} />
        <div>Actions</div>
      </div>

      {#if instancesLoading && sortedInstanceRows.length === 0}
        <div class="px-4 py-6 text-sm text-muted-foreground">Loading instances…</div>
      {:else if sortedInstanceRows.length === 0}
        <div class="px-4 py-6 text-sm text-muted-foreground">No instances found for this custom resource.</div>
      {:else}
        {#each sortedInstanceRows as instance (instance.uid)}
          <div class="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_auto] gap-3 border-t border-border/60 px-4 py-3 text-sm">
            <div class="min-w-0 truncate font-medium text-foreground">{instance.name}</div>
            <div class="min-w-0 truncate text-muted-foreground">{instance.namespace}</div>
            <div class="min-w-0 truncate text-muted-foreground">{instance.status}</div>
            <div class="min-w-0 truncate text-muted-foreground">{instance.age}</div>
            <div class="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onclick={() => openInstanceYaml(requireActiveInstancesDefinition(), instance)}
              >
                YAML
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onclick={() => {
                  void copyInstanceYaml(requireActiveInstancesDefinition(), instance);
                }}
              >
                Copy YAML
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onclick={() => {
                  void copyInstanceDescribe(requireActiveInstancesDefinition(), instance);
                }}
              >
                Describe
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onclick={() => {
                  runInstanceDebugDescribe(requireActiveInstancesDefinition(), instance);
                }}
              >
                Debug
              </Button>
              <Button
                variant="destructive"
                size="sm"
                loading={deletingInstanceId === instance.uid}
                loadingLabel="Deleting"
                onclick={() => {
                  void deleteInstance(requireActiveInstancesDefinition(), instance);
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        {/each}
      {/if}
    </section>
  {/if}

  <CustomResourcesDetailsSheet
    row={selectedRow}
    isOpen={detailsOpen}
    onClose={() => {
      detailsOpen = false;
    }}
    onOpenYaml={(row) => {
      detailsOpen = false;
      openYamlWorkbench(row);
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
    onBrowseInstances={(row) => {
      detailsOpen = false;
      void loadInstances(row);
    }}
    onDelete={(row) => {
      void deleteRows([row]);
    }}
  />

  <ResourceYamlWorkbenchPanel
    clusterId={data.slug}
    request={workbenchRequest}
    onMessage={(message) => {
      actionNotification = notifySuccess(message);
    }}
    onError={(message) => {
      actionNotification = notifyError(message);
    }}
  />
</div>
