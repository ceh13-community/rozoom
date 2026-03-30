<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { path } from "@tauri-apps/api";
  import { openExternalUrl } from "$shared/api/in-app-browser";
  import { confirmAction } from "$shared/lib/confirm-action";
  import { isTauriAvailable } from "$shared/lib/tauri-runtime";
  import { resolveClusterIds, resolvePrimaryClusterId } from "$shared/lib/cluster-ids";
  import { debounce } from "$shared/lib/debounce";
  import {
    buildTextExportFilename,
    exportCsvArtifact,
    exportTextArtifact,
  } from "$shared/lib/text-export";
  import { readJsonFromStorage, writeJsonToStorage } from "$shared/lib/local-storage";
  import {
    dashboardDataProfile,
    getDashboardDataProfileDisplayName,
    resolveCoreResourceSyncPolicy,
  } from "$shared/lib/dashboard-data-profile.svelte";
  import { createWorkloadWatcher } from "./common/workload-watcher";
  import { createDetailsActionManager } from "./common/details-action-manager";
  import { normalizeWorkbenchVisibilityForDataMode } from "./common/workbench-data-mode";
  import { computeVirtualWindow } from "$shared/lib/virtual-window";
  import TablePagination from "$shared/ui/table-pagination.svelte";
  import { totalPages as calcTotalPages } from "$shared/lib/use-pagination";
  import { popOutPortForwardPreview, withRefreshNonce } from "$shared/lib/port-forward-preview";
  import { requestPortForwardStartMode } from "$shared/lib/port-forward-start-mode";
  import {
    isRunningForwardByKey,
    selectLatestPortForwardsByTabId,
  } from "$shared/lib/port-forward-sync";
  import { BaseDirectory, mkdir, remove, writeTextFile } from "@tauri-apps/plugin-fs";
  import { load as parseYaml, YAMLException } from "js-yaml";
  import { writable } from "svelte/store";
  import type { PageData } from "$entities/cluster";
  import { getResourceSchema } from "$entities/workload";
  import * as Alert from "$shared/ui/alert";
  import { Button, SortingButton } from "$shared/ui/button";
  import { Input } from "$shared/ui/input";
  import ActionNotificationBar from "$shared/ui/action-notification-bar.svelte";
  import {
    notifySuccess,
    notifyError,
    type ActionNotification,
  } from "$shared/lib/action-notification";
  import * as Table from "$shared/ui/table";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import { getTimeDifference } from "$shared";
  import GitCompareArrows from "@lucide/svelte/icons/git-compare-arrows";
  import Pin from "@lucide/svelte/icons/pin";
  import PinOff from "@lucide/svelte/icons/pin-off";
  import Target from "@lucide/svelte/icons/target";
  import FileDown from "@lucide/svelte/icons/file-down";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Copy from "@lucide/svelte/icons/copy";
  import Eye from "@lucide/svelte/icons/eye";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import Link2 from "@lucide/svelte/icons/link-2";
  import Info from "@lucide/svelte/icons/info";
  import Search from "@lucide/svelte/icons/search";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Trash from "@lucide/svelte/icons/trash";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import X from "@lucide/svelte/icons/x";
  import { ChevronDown as TableChevronDown, Layers3, List } from "$shared/ui/icons";
  import { KUBECTL_COMMANDS } from "$shared/config/kubectl-commands";
  import type { WorkloadType } from "$shared/model/workloads";
  import { kubectlJson, kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
  import { getSelectedNamespaceList, selectedNamespace } from "$features/namespace-management";
  import {
    buildResourceRelationGraph,
    decodeWorkbenchRouteState,
    deleteSavedView,
    encodeWorkbenchRouteState,
    listSavedViews,
    toWorkloadError,
    trackWorkloadEvent,
    upsertSavedView,
  } from "$features/workloads-management";
  import { checkYamlDrift, buildDriftMessage } from "$features/pod-yaml-editor";
  import {
    computeLayoutClosePlan,
    formatApplyErrorMessage,
    orderPinnedTabs,
  } from "$features/pods-workbench";
  import {
    applyConfigurationItemEvent,
    destroyConfigurationSync,
    initConfigurationSync,
    markConfigurationSyncError,
    markConfigurationSyncLoading,
    markConfigurationSyncSuccess,
    resetConfigurationSyncStatus,
    selectClusterConfigurationItems,
    setInitialConfigurationItems,
    setConfigurationSyncEnabled,
  } from "$features/check-health";
  import {
    getGroupCollapseToggleLabel,
    toggleAllGroupsCollapsed,
  } from "./model/group-collapse-toggle";
  import {
    evaluateRbacRisk,
    renderConfigurationSummary,
  } from "./configuration-list/model/resource-renderers";
  import { type QuickFilterId } from "./configuration-list/model/quick-filters";
  import { computeConfigurationRows } from "./configuration-list/model/rows-query";
  import TableChecklistDropdown from "./table-checklist-dropdown.svelte";
  import ConfigurationSelectionCheckbox from "./configuration-list/configuration-selection-checkbox.svelte";
  import ConfigurationActionsMenu from "./configuration-list/configuration-actions-menu.svelte";
  import ConfigurationBulkActions from "./configuration-list/configuration-bulk-actions.svelte";
  import DetailsHeaderActions from "./common/details-header-actions.svelte";
  import DetailsMetadataGrid from "./common/details-metadata-grid.svelte";
  import DetailsEventsList from "./common/details-events-list.svelte";
  import MultiPaneWorkbench from "$shared/ui/multi-pane-workbench.svelte";
  import {
    buildKubectlDescribeCommand as buildKubectlDescribeCliCommand,
    buildKubectlGetYamlCommand as buildKubectlGetYamlCliCommand,
  } from "./common/kubectl-command-builder";
  import { runDebugDescribe } from "$features/resource-debug-runtime";
  import { invalidateWorkloadSnapshotCache } from "./common/workload-cache-invalidation";
  import PortForwardBrowserTab from "./common/port-forward-browser-tab.svelte";
  import ResourceYamlSheet from "./common/resource-yaml-sheet.svelte";
  import DetailsSheetPortal from "$shared/ui/details-sheet-portal.svelte";
  import ResourceTrafficChain from "./common/resource-traffic-chain.svelte";
  import PvcUsageBar from "./common/pvc-usage-bar.svelte";
  import {
    activePortForwards,
    startPortForward,
    stopPortForward,
    type PortForwardProcess,
  } from "$shared/api/port-forward";
  import Bug from "@lucide/svelte/icons/bug";
  import { createMutationReconcile } from "./common/workload-mutation-reconcile";
  import TableToolbarShell from "./table-toolbar-shell.svelte";
  import WatcherToolbarControls from "./watcher-toolbar-controls.svelte";
  import {
    confirmWorkbenchLayoutShrink,
    confirmWorkbenchTabClose,
  } from "./common/workbench-confirm";
  import SectionRuntimeStatus from "./common/section-runtime-status.svelte";
  import WorkloadSelectionBar from "./common/workload-selection-bar.svelte";
  import ResourceSummaryStrip from "./common/resource-summary-strip.svelte";

  type GenericItem = Record<string, unknown>;
  type SortBy =
    | "problemScore"
    | "name"
    | "namespace"
    | "createdAt"
    | "keys"
    | "type"
    | "resourceVersion"
    | "value"
    | "globalDefault"
    | "serviceType"
    | "clusterIP"
    | "ports"
    | "phase"
    | "labels"
    | "handler"
    | "holder"
    | "webhooks"
    | "status"
    | "minAvailable"
    | "maxUnavailable"
    | "currentHealthy"
    | "desiredHealthy"
    | "metrics"
    | "minPods"
    | "maxPods"
    | "replicas"
    | "bindings"
    | "resource"
    | "group"
    | "version"
    | "scope"
    | "kind"
    | "controller"
    | "apiGroup"
    | "externalIP"
    | "selector"
    | "endpoints"
    | "loadBalancers"
    | "policyTypes"
    | "storageClass"
    | "size"
    | "pods"
    | "capacity"
    | "storage"
    | "claim"
    | "provisioner"
    | "reclaimPolicy"
    | "isDefaultStorageClass";
  type SortDirection = "asc" | "desc";
  type SortPresetId = "default" | "problems" | "name" | "newest";
  type ConfigurationTableViewMode = "flat" | "namespace";
  type WatcherSettings = {
    enabled: boolean;
    refreshSeconds: number;
    viewMode: ConfigurationTableViewMode;
  };

  const WATCHER_SETTINGS_PREFIX = "dashboard.configuration.watcher.settings.v2";
  const WORKBENCH_SETTINGS_PREFIX = "dashboard.configuration.workbench.ui.v1";
  const TABLE_STATE_PREFIX = "dashboard.configuration.table.state.v1";
  const DEFAULT_WATCHER_SETTINGS: WatcherSettings = {
    enabled: true,
    refreshSeconds: 30,
    viewMode: "flat",
  };

  interface Props {
    data: PageData & {
      uuid?: string;
      items?: GenericItem[];
      workloadKey?: string | null;
    };
  }

  type ConfigurationRow = {
    uid: string;
    problemScore: number;
    name: string;
    namespace: string;
    createdAt: string;
    age: string;
    keys: number;
    labels: string;
    type: string;
    handler: string;
    holder: string;
    webhooks: number;
    status: string;
    minAvailable: string;
    maxUnavailable: string;
    currentHealthy: number;
    desiredHealthy: number;
    metrics: number;
    minPods: number;
    maxPods: number;
    replicas: string;
    bindings: string;
    resource: string;
    group: string;
    version: string;
    scope: string;
    kind: string;
    controller: string;
    apiGroup: string;
    externalIP: string;
    selector: string;
    endpoints: string;
    loadBalancers: string;
    policyTypes: string;
    storageClass: string;
    size: string;
    pods: string;
    capacity: string;
    resourceVersion: string;
    rbacRiskScore: number;
    value: string;
    globalDefault: boolean;
    serviceType: string;
    clusterIP: string;
    ports: number;
    phase: string;
    storage: string;
    claim: string;
    provisioner: string;
    reclaimPolicy: string;
    isDefaultStorageClass: boolean;
    driftDetected: boolean;
    details: string;
    raw: GenericItem;
  };

  type ConfigurationWorkerRow = Omit<ConfigurationRow, "raw">;

  type SavedConfigurationView = {
    id: string;
    name: string;
  };

  type YamlTabState = {
    id: string;
    target: { name: string; namespace: string };
    yamlOriginalText: string;
    yamlText: string;
    yamlError: string | null;
    yamlLoading: boolean;
    yamlSaving: boolean;
    yamlDriftDetected: boolean;
    yamlDriftMessage: string | null;
    yamlDriftClusterYaml: string;
  };

  type WorkbenchTab = {
    id: string;
    kind: "yaml" | "port-forward";
    title: string;
    subtitle: string;
  };
  type WorkbenchLayout = "single" | "dual" | "triple";
  type ClosedWorkbenchTab = {
    target: { name: string; namespace: string };
    pinned: boolean;
  };
  type PersistedYamlWorkbenchTab = {
    name: string;
    namespace: string;
    pinned: boolean;
  };
  type PortForwardBrowserTabState = {
    id: string;
    target: { name: string; namespace: string; remotePort: number; localPort: number };
    url: string;
    uniqueKey: string;
    loading: boolean;
    statusMessage: string | null;
  };

  const { data }: Props = $props();
  const workloadKey = $derived((data.workloadKey ?? data.workload ?? "") as WorkloadType);
  const clusterIds = $derived.by(() => resolveClusterIds({ uuid: data.uuid, slug: data.slug }));
  const clusterId = $derived(resolvePrimaryClusterId({ uuid: data.uuid, slug: data.slug }));
  const scopeKey = $derived(`${clusterId}:${workloadKey}`);

  const titleByWorkload: Record<string, string> = {
    namespaces: "Namespaces",
    replicationcontrollers: "Replication Controllers",
    configmaps: "ConfigMaps",
    secrets: "Secrets",
    resourcequotas: "Resource Quotas",
    limitranges: "Limit Ranges",
    horizontalpodautoscalers: "Horizontal Pod Autoscalers",
    poddisruptionbudgets: "Pod Disruption Budgets",
    priorityclasses: "Priority Classes",
    runtimeclasses: "Runtime Classes",
    leases: "Leases",
    mutatingwebhookconfigurations: "Mutating Webhooks",
    validatingwebhookconfigurations: "Validating Webhooks",
    serviceaccounts: "Service Accounts",
    roles: "Roles",
    rolebindings: "Role Bindings",
    clusterroles: "Cluster Roles",
    clusterrolebindings: "Cluster Role Bindings",
    customresourcedefinitions: "Custom Resource Definitions",
    services: "Services",
    endpoints: "Endpoints",
    endpointslices: "EndpointSlices",
    ingresses: "Ingresses",
    ingressclasses: "Ingress Classes",
    gatewayclasses: "Gateway Classes",
    gateways: "Gateways",
    httproutes: "HTTP Routes",
    referencegrants: "Reference Grants",
    networkpolicies: "Network Policies",
    persistentvolumeclaims: "Persistent Volume Claims",
    persistentvolumes: "Persistent Volumes",
    storageclasses: "Storage Classes",
    volumeattributesclasses: "Volume Attributes Classes",
    volumesnapshots: "Volume Snapshots",
    volumesnapshotcontents: "Volume Snapshot Contents",
    volumesnapshotclasses: "Volume Snapshot Classes",
    csistoragecapacities: "CSI Storage Capacities",
  };
  const singularLabelByWorkload: Record<string, string> = {
    namespaces: "Namespace",
    replicationcontrollers: "ReplicationController",
    configmaps: "ConfigMap",
    secrets: "Secret",
    resourcequotas: "ResourceQuota",
    limitranges: "LimitRange",
    horizontalpodautoscalers: "HorizontalPodAutoscaler",
    poddisruptionbudgets: "PodDisruptionBudget",
    priorityclasses: "PriorityClass",
    runtimeclasses: "RuntimeClass",
    leases: "Lease",
    mutatingwebhookconfigurations: "MutatingWebhookConfiguration",
    validatingwebhookconfigurations: "ValidatingWebhookConfiguration",
    serviceaccounts: "ServiceAccount",
    roles: "Role",
    rolebindings: "RoleBinding",
    clusterroles: "ClusterRole",
    clusterrolebindings: "ClusterRoleBinding",
    customresourcedefinitions: "CustomResourceDefinition",
    services: "Service",
    endpoints: "Endpoint",
    endpointslices: "EndpointSlice",
    ingresses: "Ingress",
    ingressclasses: "IngressClass",
    gatewayclasses: "GatewayClass",
    gateways: "Gateway",
    httproutes: "HTTPRoute",
    referencegrants: "ReferenceGrant",
    networkpolicies: "NetworkPolicy",
    persistentvolumeclaims: "PersistentVolumeClaim",
    persistentvolumes: "PersistentVolume",
    storageclasses: "StorageClass",
    volumeattributesclasses: "VolumeAttributesClass",
    volumesnapshots: "VolumeSnapshot",
    volumesnapshotcontents: "VolumeSnapshotContent",
    volumesnapshotclasses: "VolumeSnapshotClass",
    csistoragecapacities: "CSIStorageCapacity",
  };
  const resourceByWorkload: Record<string, string> = {
    namespaces: "namespaces",
    replicationcontrollers: "replicationcontrollers",
    configmaps: "configmaps",
    secrets: "secrets",
    resourcequotas: "resourcequotas",
    limitranges: "limitranges",
    horizontalpodautoscalers: "horizontalpodautoscalers",
    poddisruptionbudgets: "poddisruptionbudgets",
    priorityclasses: "priorityclasses",
    runtimeclasses: "runtimeclasses",
    leases: "leases",
    mutatingwebhookconfigurations: "mutatingwebhookconfigurations",
    validatingwebhookconfigurations: "validatingwebhookconfigurations",
    serviceaccounts: "serviceaccounts",
    roles: "roles",
    rolebindings: "rolebindings",
    clusterroles: "clusterroles",
    clusterrolebindings: "clusterrolebindings",
    customresourcedefinitions: "customresourcedefinitions",
    services: "services",
    endpoints: "endpoints",
    endpointslices: "endpointslices",
    ingresses: "ingresses",
    ingressclasses: "ingressclasses",
    gatewayclasses: "gatewayclasses",
    gateways: "gateways",
    httproutes: "httproutes",
    referencegrants: "referencegrants",
    networkpolicies: "networkpolicies",
    persistentvolumeclaims: "persistentvolumeclaims",
    persistentvolumes: "persistentvolumes",
    storageclasses: "storageclasses",
    volumeattributesclasses: "volumeattributesclasses",
    volumesnapshots: "volumesnapshots",
    volumesnapshotcontents: "volumesnapshotcontents",
    volumesnapshotclasses: "volumesnapshotclasses",
    csistoragecapacities: "csistoragecapacities",
  };

  const namespaceScoped = new Set([
    "replicationcontrollers",
    "configmaps",
    "secrets",
    "resourcequotas",
    "limitranges",
    "horizontalpodautoscalers",
    "poddisruptionbudgets",
    "leases",
    "serviceaccounts",
    "roles",
    "rolebindings",
    "services",
    "endpoints",
    "endpointslices",
    "ingresses",
    "gateways",
    "httproutes",
    "referencegrants",
    "networkpolicies",
    "persistentvolumeclaims",
    "volumesnapshots",
    "csistoragecapacities",
  ]);
  const problemFirstWorkloads = new Set<WorkloadType>([
    "replicationcontrollers",
    "configmaps",
    "secrets",
    "poddisruptionbudgets",
    "horizontalpodautoscalers",
    "persistentvolumeclaims",
    "persistentvolumes",
    "services",
    "ingresses",
    "endpoints",
    "endpointslices",
    "volumesnapshots",
    "volumesnapshotcontents",
    "gateways",
    "httproutes",
    "namespaces",
    "serviceaccounts",
    "roles",
    "rolebindings",
    "clusterroles",
    "clusterrolebindings",
    "networkpolicies",
  ]);
  const nameFirstWorkloads = new Set<WorkloadType>([
    "resourcequotas",
    "limitranges",
    "runtimeclasses",
    "leases",
    "mutatingwebhookconfigurations",
    "validatingwebhookconfigurations",
    "customresourcedefinitions",
    "ingressclasses",
    "gatewayclasses",
    "referencegrants",
    "volumeattributesclasses",
    "volumesnapshotclasses",
  ]);
  const resourceSchema = $derived(getResourceSchema(workloadKey));
  const tableTitle = $derived(
    resourceSchema?.title ?? titleByWorkload[workloadKey] ?? "Configuration",
  );
  const isNamespaceScoped = $derived(namespaceScoped.has(workloadKey));
  const isNamespacesWorkload = $derived(workloadKey === "namespaces");
  const SYSTEM_NAMESPACES = new Set(["kube-system", "kube-public", "kube-node-lease", "default"]);

  function getDetailsResourceLabel() {
    return resourceSchema?.singularTitle ?? singularLabelByWorkload[workloadKey] ?? "Resource";
  }

  type ColumnVisibilityState = {
    name: boolean;
    namespace: boolean;
    createdAt: boolean;
    keys: boolean;
    labels: boolean;
    type: boolean;
    handler: boolean;
    holder: boolean;
    webhooks: boolean;
    status: boolean;
    minAvailable: boolean;
    maxUnavailable: boolean;
    currentHealthy: boolean;
    desiredHealthy: boolean;
    metrics: boolean;
    minPods: boolean;
    maxPods: boolean;
    replicas: boolean;
    bindings: boolean;
    resource: boolean;
    group: boolean;
    version: boolean;
    scope: boolean;
    kind: boolean;
    controller: boolean;
    apiGroup: boolean;
    externalIP: boolean;
    selector: boolean;
    endpoints: boolean;
    loadBalancers: boolean;
    policyTypes: boolean;
    storageClass: boolean;
    size: boolean;
    pods: boolean;
    capacity: boolean;
    resourceVersion: boolean;
    value: boolean;
    globalDefault: boolean;
    serviceType: boolean;
    clusterIP: boolean;
    ports: boolean;
    phase: boolean;
    storage: boolean;
    claim: boolean;
    provisioner: boolean;
    reclaimPolicy: boolean;
    isDefaultStorageClass: boolean;
  };

  function getDefaultColumnsForWorkload(): ColumnVisibilityState {
    if (workloadKey === "priorityclasses") {
      return {
        name: true,
        namespace: false,
        createdAt: true,
        keys: false,
        labels: false,
        type: false,
        handler: false,
        holder: false,
        webhooks: false,
        status: false,
        minAvailable: false,
        maxUnavailable: false,
        currentHealthy: false,
        desiredHealthy: false,
        metrics: false,
        minPods: false,
        maxPods: false,
        replicas: false,
        bindings: false,
        resource: false,
        group: false,
        version: false,
        scope: false,
        kind: false,
        controller: false,
        apiGroup: false,
        externalIP: false,
        selector: false,
        endpoints: false,
        loadBalancers: false,
        policyTypes: false,
        storageClass: false,
        size: false,
        pods: false,
        capacity: false,
        resourceVersion: false,
        value: true,
        globalDefault: true,
        serviceType: false,
        clusterIP: false,
        ports: false,
        phase: false,
        storage: false,
        claim: false,
        provisioner: false,
        reclaimPolicy: false,
        isDefaultStorageClass: false,
      };
    }
    return {
      name: true,
      namespace: isNamespaceScoped || workloadKey === "ingressclasses",
      createdAt: true,
      keys: workloadKey === "configmaps" || workloadKey === "secrets",
      labels: workloadKey === "namespaces" || workloadKey === "secrets",
      type:
        workloadKey === "secrets" ||
        workloadKey === "ingressclasses" ||
        workloadKey === "gatewayclasses",
      handler: workloadKey === "runtimeclasses",
      holder: workloadKey === "leases",
      webhooks:
        workloadKey === "mutatingwebhookconfigurations" ||
        workloadKey === "validatingwebhookconfigurations",
      status:
        workloadKey === "replicationcontrollers" ||
        workloadKey === "namespaces" ||
        workloadKey === "horizontalpodautoscalers" ||
        workloadKey === "services" ||
        workloadKey === "endpointslices" ||
        workloadKey === "volumesnapshots" ||
        workloadKey === "volumesnapshotcontents" ||
        workloadKey === "persistentvolumeclaims" ||
        workloadKey === "persistentvolumes",
      minAvailable: workloadKey === "poddisruptionbudgets",
      maxUnavailable: workloadKey === "poddisruptionbudgets",
      currentHealthy: workloadKey === "poddisruptionbudgets",
      desiredHealthy: workloadKey === "poddisruptionbudgets",
      metrics: workloadKey === "horizontalpodautoscalers",
      minPods: workloadKey === "horizontalpodautoscalers",
      maxPods: workloadKey === "horizontalpodautoscalers",
      replicas:
        workloadKey === "horizontalpodautoscalers" || workloadKey === "replicationcontrollers",
      bindings: workloadKey === "rolebindings" || workloadKey === "clusterrolebindings",
      resource: workloadKey === "customresourcedefinitions",
      group: workloadKey === "customresourcedefinitions",
      version: workloadKey === "customresourcedefinitions",
      scope: workloadKey === "customresourcedefinitions" || workloadKey === "ingressclasses",
      kind: workloadKey === "ingressclasses",
      controller: workloadKey === "ingressclasses",
      apiGroup: workloadKey === "ingressclasses",
      externalIP: workloadKey === "services",
      selector: workloadKey === "services" || workloadKey === "replicationcontrollers",
      endpoints: workloadKey === "endpoints" || workloadKey === "endpointslices",
      loadBalancers: workloadKey === "ingresses",
      policyTypes: workloadKey === "networkpolicies",
      storageClass:
        workloadKey === "persistentvolumeclaims" ||
        workloadKey === "persistentvolumes" ||
        workloadKey === "storageclasses" ||
        workloadKey === "volumesnapshots" ||
        workloadKey === "csistoragecapacities",
      size:
        workloadKey === "persistentvolumeclaims" ||
        workloadKey === "volumesnapshots" ||
        workloadKey === "volumesnapshotcontents",
      pods: workloadKey === "persistentvolumeclaims",
      capacity: workloadKey === "persistentvolumes" || workloadKey === "csistoragecapacities",
      resourceVersion: ![
        "namespaces",
        "resourcequotas",
        "limitranges",
        "runtimeclasses",
        "leases",
        "mutatingwebhookconfigurations",
        "validatingwebhookconfigurations",
        "horizontalpodautoscalers",
        "poddisruptionbudgets",
        "services",
        "endpoints",
        "endpointslices",
        "ingresses",
        "ingressclasses",
        "networkpolicies",
        "persistentvolumeclaims",
        "persistentvolumes",
        "storageclasses",
        "volumeattributesclasses",
        "volumesnapshots",
        "volumesnapshotcontents",
        "volumesnapshotclasses",
        "csistoragecapacities",
        "customresourcedefinitions",
        "rolebindings",
        "clusterrolebindings",
        "replicationcontrollers",
      ].includes(workloadKey),
      value: false,
      globalDefault: false,
      serviceType: false,
      clusterIP: false,
      ports:
        workloadKey === "services" ||
        workloadKey === "ingresses" ||
        workloadKey === "endpointslices",
      phase: false,
      storage: false,
      claim: workloadKey === "persistentvolumes" || workloadKey === "volumesnapshotcontents",
      provisioner:
        workloadKey === "storageclasses" ||
        workloadKey === "volumeattributesclasses" ||
        workloadKey === "volumesnapshotcontents" ||
        workloadKey === "volumesnapshotclasses",
      reclaimPolicy:
        workloadKey === "storageclasses" ||
        workloadKey === "volumesnapshotcontents" ||
        workloadKey === "volumesnapshotclasses",
      isDefaultStorageClass:
        workloadKey === "storageclasses" || workloadKey === "volumesnapshotclasses",
    };
  }

  function getDefaultSortForWorkload(): { by: SortBy; direction: SortDirection } {
    if (workloadKey === "priorityclasses") {
      return { by: "value", direction: "desc" };
    }
    if (workloadKey === "storageclasses" || workloadKey === "volumesnapshotclasses") {
      return { by: "isDefaultStorageClass", direction: "desc" };
    }
    if (problemFirstWorkloads.has(workloadKey)) {
      return { by: "problemScore", direction: "desc" };
    }
    if (nameFirstWorkloads.has(workloadKey)) {
      return { by: "name", direction: "asc" };
    }
    return { by: "name", direction: "asc" };
  }

  function supportsProblemSortPreset(): boolean {
    return problemFirstWorkloads.has(workloadKey);
  }

  function getCurrentSortPreset(): SortPresetId {
    const defaults = getDefaultSortForWorkload();
    if (sortBy === defaults.by && sortDirection === defaults.direction) return "default";
    if (sortBy === "problemScore" && sortDirection === "desc") return "problems";
    if (sortBy === "name" && sortDirection === "asc") return "name";
    if (sortBy === "createdAt" && sortDirection === "desc") return "newest";
    return "default";
  }

  function applySortPreset(preset: SortPresetId) {
    if (preset === "default") {
      const defaults = getDefaultSortForWorkload();
      sortBy = defaults.by;
      sortDirection = defaults.direction;
      return;
    }
    if (preset === "problems") {
      if (!supportsProblemSortPreset()) return;
      sortBy = "problemScore";
      sortDirection = "desc";
      return;
    }
    if (preset === "name") {
      sortBy = "name";
      sortDirection = "asc";
      return;
    }
    sortBy = "createdAt";
    sortDirection = "desc";
  }

  let rowsSnapshot = $state<ConfigurationRow[]>([]);
  const rowsSnapshotByUid = $derived.by(() => new Map(rowsSnapshot.map((row) => [row.uid, row])));
  let watcherEnabled = $state(DEFAULT_WATCHER_SETTINGS.enabled);
  let watcherRefreshSeconds = $state(DEFAULT_WATCHER_SETTINGS.refreshSeconds);
  let watcherError = $state<string | null>(null);
  let actionInFlight = $state(false);
  let watcherInFlight = $state(false);
  let configurationSyncStarted = $state(false);
  let activeConfigurationSyncScopeKey = $state<string | null>(null);
  let configurationSyncStoreUnsubscribe: (() => void) | null = null;
  let previousSyncScopeKey = $state<string | null>(null);
  const watcherPolicy = $derived.by(() =>
    resolveCoreResourceSyncPolicy($dashboardDataProfile, {
      userEnabled: watcherEnabled,
      requestedRefreshSeconds: watcherRefreshSeconds,
      supportsStream: true,
    }),
  );
  const watcherEngine = createWorkloadWatcher({
    workloadName: () => workloadKey,
    isEnabled: () => watcherPolicy.enabled,
    getRefreshSeconds: () => watcherPolicy.refreshSeconds,
    onTick: async () => {
      await refreshNow("watcher");
    },
  });
  const mutationReconcile = createMutationReconcile({
    isSyncEnabled: () => watcherPolicy.enabled,
    getSyncMode: () => watcherPolicy.mode,
    getClusterId: () => clusterId,
    getScopeKey: () => (workloadKey ? `configuration:${workloadKey}` : null),
    refresh: () => refreshNow("watcher"),
  });
  let lastWatcherSuccessAt = $state<number | null>(null);
  let errorMessage = $state<string | null>(null);
  let actionNotification = $state<ActionNotification>(null);

  let viewMode = $state<ConfigurationTableViewMode>(DEFAULT_WATCHER_SETTINGS.viewMode);
  let collapsedGroups = $state(new Set<string>());
  let selectedNamespaces = $state(new Set<string>());
  let namespacesInitialized = false;
  let previousAvailableNamespaces: string[] = [];
  const SEARCH_DEBOUNCE_MS = import.meta.env.MODE === "test" ? 0 : 120;
  let search = $state("");
  let searchInput = $state("");
  const applySearchDebounced = debounce((value: string) => {
    search = value;
  }, SEARCH_DEBOUNCE_MS);
  let quickFilter = $state<QuickFilterId>("all");
  let sortBy = $state<SortBy>(getDefaultSortForWorkload().by);
  let sortDirection = $state<SortDirection>(getDefaultSortForWorkload().direction);
  let selectedRowIds = $state(new Set<string>());
  let selectedDetail = $state<ConfigurationRow | null>(null);
  let detailsOpen = $state(false);
  let detailsEvents = $state<
    Array<{
      type?: string;
      reason?: string;
      message?: string;
      lastTimestamp?: string;
      source?: string;
      count?: string | number;
    }>
  >([]);
  let detailsEventsLoading = $state(false);
  let detailsEventsError = $state<string | null>(null);
  const detailsActions = createDetailsActionManager();
  let showManagedFieldsDetails = $state(false);
  let dataDetailsSearch = $state("");
  type SecretKeyState = "masked" | "base64" | "decoded";
  let secretKeyStates = $state<Map<string, SecretKeyState>>(new Map());
  let secretGlobalState = $state<SecretKeyState>("masked");
  let savedViews = $state<SavedConfigurationView[]>([]);
  let selectedSavedViewId = $state<string>("");
  let newSavedViewName = $state("");
  const workbenchOpen = writable(true);
  let workbenchTabs = $state<WorkbenchTab[]>([]);
  let yamlTabs = $state<YamlTabState[]>([]);
  let portForwardTabs = $state<PortForwardBrowserTabState[]>([]);
  let closedWorkbenchTabs = $state<ClosedWorkbenchTab[]>([]);
  let pinnedTabIds = $state(new Set<string>());
  let paneTabIds = $state<[string | null, string | null, string | null]>([null, null, null]);
  let collapsedPaneIndexes = $state<number[]>([]);
  let yamlCompareSourceTabId = $state<string | null>(null);
  let yamlComparePair = $state<[string, string] | null>(null);
  let yamlCompareTargetTabId = $state<string | null>(null);
  let activeWorkbenchTabId = $state<string | null>(null);
  let workbenchRootEl = $state<HTMLDivElement | null>(null);
  let workbenchFullscreen = $state(false);
  let workbenchCollapsed = $state(false);
  let workbenchLayout = $state<WorkbenchLayout>("single");
  let pendingRestoredTabs = $state<PersistedYamlWorkbenchTab[] | null>(null);
  let workbenchStateRestored = $state(false);
  let freshnessTimer: ReturnType<typeof setInterval> | null = null;
  let freshnessNow = $state(Date.now());
  let watcherSettingsLoaded = false;
  let tableStateLoaded = false;
  let initializedScopeKey: string | null = null;
  let tableScrollHost = $state<HTMLDivElement | null>(null);
  let tableScrollTop = $state(0);
  let tableViewportHeight = $state(720);
  let configPageIndex = $state(0);
  let configPageSize = $state(100);
  let columnsVisible = $state<ColumnVisibilityState>(getDefaultColumnsForWorkload());
  let namespaceCreateName = $state("");
  let namespaceLabelsText = $state("");
  let namespaceAnnotationsText = $state("");
  let namespaceTargetName = $state("");
  let bootstrapTargetNamespace = $state("");
  let configurationRowsWorker: Worker | null = null;
  let configurationRowsWorkerRequestId = 0;
  let configurationRowsWorkerResult = $state<ConfigurationWorkerRow[] | null>(null);
  let configurationRowsWorkerFailures = 0;
  let configurationRowsWorkerDisabled = $state(false);
  const VIRTUALIZATION_THRESHOLD = 200;
  const VIRTUALIZATION_ROW_HEIGHT = 42;
  const VIRTUALIZATION_OVERSCAN = 12;
  const CONFIGURATION_ROWS_WORKER_THRESHOLD = 400;
  const ENABLE_CONFIGURATION_ROWS_WORKER =
    import.meta.env.VITE_ENABLE_CONFIGURATION_ROWS_WORKER !== "false";

  function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  }

  function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  function getMetadata(item: GenericItem) {
    return asRecord(item.metadata);
  }

  function getName(item: GenericItem): string {
    const metadata = getMetadata(item);
    return typeof metadata.name === "string" ? metadata.name : "-";
  }

  function getNamespace(item: GenericItem): string {
    const metadata = getMetadata(item);
    return typeof metadata.namespace === "string" ? metadata.namespace : "cluster";
  }

  function getCreatedAt(item: GenericItem): string {
    const metadata = getMetadata(item);
    const ts = metadata.creationTimestamp;
    return typeof ts === "string" ? ts : "";
  }

  function labelsSummary(item: GenericItem): string {
    const labels = asRecord(getMetadata(item).labels);
    const pairs = Object.entries(labels).map(([key, value]) => `${key}=${String(value)}`);
    return pairs.length > 0 ? pairs.join(", ") : "-";
  }

  function hasLastAppliedDrift(item: GenericItem): boolean {
    const metadata = asRecord(item.metadata);
    const annotations = asRecord(metadata.annotations);
    const lastApplied = annotations["kubectl.kubernetes.io/last-applied-configuration"];
    if (typeof lastApplied !== "string" || lastApplied.trim().length === 0) return false;
    try {
      const parsed = JSON.parse(lastApplied) as Record<string, unknown>;
      const appliedSpec = asRecord(parsed.spec);
      const currentSpec = asRecord(item.spec);
      return JSON.stringify(appliedSpec) !== JSON.stringify(currentSpec);
    } catch {
      return false;
    }
  }

  function describeDetails(item: GenericItem): string {
    return renderConfigurationSummary(workloadKey, item).details;
  }

  function buildConfigurationProblemScore(item: GenericItem): number {
    const metadata = asRecord(item.metadata);
    const status = asRecord(item.status);

    let score = 0;

    if (metadata.deletionTimestamp) score += 500;

    const conditions = asArray(status.conditions);
    for (const condition of conditions) {
      const record = asRecord(condition);
      const value = String(record.status ?? "").toLowerCase();
      if (value === "false") score += 220;
      if (value === "unknown") score += 140;
    }
    return score + renderConfigurationSummary(workloadKey, item).scoreDelta;
  }

  function toRow(item: GenericItem, index: number): ConfigurationRow {
    const metadata = getMetadata(item);
    const spec = asRecord(item.spec);
    const status = asRecord(item.status);
    const uidCandidate = typeof metadata.uid === "string" ? metadata.uid : "";
    const name = getName(item);
    const namespace = getNamespace(item);
    const keys = Object.keys(asRecord(item.data)).length;
    const labels = labelsSummary(item);
    const type =
      workloadKey === "secrets"
        ? String(item.type ?? "Opaque")
        : workloadKey === "configmaps"
          ? "ConfigMap"
          : workloadKey === "gatewayclasses"
            ? String(spec.controllerName ?? "-")
            : "-";
    const rvRaw = String(metadata.resourceVersion ?? "");
    const resourceVersion = rvRaw ? (rvRaw.length > 8 ? rvRaw.slice(-8) : rvRaw) : "-";
    const priorityValue = String(item.value ?? "-");
    const handler = String(spec.handler ?? "-");
    const holder = String(spec.holderIdentity ?? "-");
    const webhooks = asArray(item.webhooks).length;
    const pdbMinAvailable = String(spec.minAvailable ?? "-");
    const pdbMaxUnavailable = String(spec.maxUnavailable ?? "-");
    const pdbCurrentHealthy = Number(status.currentHealthy ?? 0);
    const pdbDesiredHealthy = Number(status.desiredHealthy ?? 0);
    const hpaMetrics = asArray(spec.metrics).length;
    const hpaMinPods = Number(spec.minReplicas ?? 1);
    const hpaMaxPods = Number(spec.maxReplicas ?? 0);
    const hpaReplicasCurrent = Number(status.currentReplicas ?? 0);
    const hpaReplicasDesired = Number(status.desiredReplicas ?? hpaReplicasCurrent);
    const hpaReplicas = `${hpaReplicasCurrent}/${hpaReplicasDesired}`;
    const hpaStatus =
      hpaReplicasCurrent === hpaReplicasDesired
        ? "Stable"
        : hpaReplicasCurrent < hpaReplicasDesired
          ? "Scaling up"
          : "Scaling down";
    const globalDefault = item.globalDefault === true;
    const serviceType = String(spec.type ?? "-");
    const clusterIP = String(spec.clusterIP ?? "-");
    const subsets = asArray(item.subsets);
    const endpointSliceEndpoints = asArray(item.endpoints);
    const endpointSlicePorts = asArray(item.ports);
    const endpointReadyCount = subsets.reduce<number>(
      (count, subset) => count + asArray(asRecord(subset).addresses).length,
      0,
    );
    const endpointNotReadyCount = subsets.reduce<number>(
      (count, subset) => count + asArray(asRecord(subset).notReadyAddresses).length,
      0,
    );
    const endpointSliceReadyCount = endpointSliceEndpoints.reduce<number>((count, endpoint) => {
      const conditions = asRecord(asRecord(endpoint).conditions);
      return count + (conditions.ready === false ? 0 : 1);
    }, 0);
    const endpointSliceNotReadyCount = endpointSliceEndpoints.reduce<number>((count, endpoint) => {
      const conditions = asRecord(asRecord(endpoint).conditions);
      return count + (conditions.ready === false ? 1 : 0);
    }, 0);
    const ports =
      asArray(spec.ports).length ||
      asArray(spec.rules).length ||
      subsets.reduce<number>(
        (count, subset) => count + asArray(asRecord(subset).ports).length,
        0,
      ) ||
      endpointSlicePorts.length;
    const phase = String(status.phase ?? "-");
    const storage = String(
      asRecord(asRecord(spec.resources).requests).storage ?? asRecord(spec.capacity).storage ?? "-",
    );
    const claimRef = asRecord(spec.claimRef);
    const claim = claimRef.name
      ? `${String(claimRef.namespace ?? "cluster")}/${String(claimRef.name)}`
      : "-";
    const provisioner = String(item.provisioner ?? spec.driverName ?? "-");
    const reclaimPolicy = String(spec.persistentVolumeReclaimPolicy ?? item.reclaimPolicy ?? "-");
    const roleRef = asRecord(item.roleRef);
    const subjects = asArray(item.subjects);
    const bindings =
      workloadKey === "rolebindings" || workloadKey === "clusterrolebindings"
        ? `${subjects.length} -> ${String(roleRef.kind ?? "Role")}/${String(roleRef.name ?? "-")}`
        : "-";
    const crdNames = asRecord(spec.names);
    const crdVersions = asArray(spec.versions).map((entry) => asRecord(entry));
    const crdStorageVersion =
      crdVersions.find((entry) => entry.storage === true)?.name ??
      crdVersions[0]?.name ??
      asArray(asRecord(status).storedVersions)[0];
    const resource =
      workloadKey === "customresourcedefinitions" ? String(crdNames.plural ?? "-") : "-";
    const group = workloadKey === "customresourcedefinitions" ? String(spec.group ?? "-") : "-";
    const version =
      workloadKey === "customresourcedefinitions" ? String(crdStorageVersion ?? "-") : "-";
    const ingressClassParameters = asRecord(spec.parameters);
    const scope =
      workloadKey === "customresourcedefinitions"
        ? String(spec.scope ?? "-")
        : workloadKey === "ingressclasses"
          ? String(ingressClassParameters.scope ?? "-")
          : "-";
    const kind =
      workloadKey === "ingressclasses" ? String(ingressClassParameters.kind ?? "-") : "-";
    const controller = workloadKey === "ingressclasses" ? String(spec.controller ?? "-") : "-";
    const apiGroup =
      workloadKey === "ingressclasses" ? String(ingressClassParameters.apiGroup ?? "-") : "-";
    const serviceLoadBalancerIngress = asArray(asRecord(status.loadBalancer).ingress)
      .map((entry) => asRecord(entry))
      .map((entry) => String(entry.ip ?? entry.hostname ?? "").trim())
      .filter((entry) => entry.length > 0);
    const serviceExternalIPs = asArray(spec.externalIPs).map((entry) => String(entry));
    const externalIP =
      workloadKey === "services"
        ? [...serviceExternalIPs, ...serviceLoadBalancerIngress].join(", ") || "-"
        : "-";
    const selector =
      workloadKey === "services"
        ? Object.entries(asRecord(spec.selector))
            .map(([key, value]) => `${key}=${String(value)}`)
            .join(", ") || "-"
        : "-";
    const endpoints =
      workloadKey === "endpoints"
        ? `${endpointReadyCount}${endpointNotReadyCount > 0 ? ` (+${endpointNotReadyCount} not ready)` : ""}`
        : workloadKey === "endpointslices"
          ? `${endpointSliceReadyCount}${endpointSliceNotReadyCount > 0 ? ` (+${endpointSliceNotReadyCount} not ready)` : ""}`
          : "-";
    const loadBalancers =
      workloadKey === "ingresses" ? serviceLoadBalancerIngress.join(", ") || "-" : "-";
    const policyTypes =
      workloadKey === "networkpolicies"
        ? asArray(spec.policyTypes)
            .map((entry) => String(entry))
            .join(", ") || "-"
        : "-";
    const pvcStorageClass = String(spec.storageClassName ?? "-");
    const pvcSize = String(asRecord(asRecord(spec.resources).requests).storage ?? "-");
    const pvcPods = "-";
    const pvStorageClass = String(spec.storageClassName ?? "-");
    const pvCapacity = String(asRecord(spec.capacity).storage ?? "-");
    const snapshotStorageClass = String(spec.volumeSnapshotClassName ?? "-");
    const snapshotRestoreSize = String(status.restoreSize ?? "-");
    const snapshotReady =
      status.readyToUse === true ? "Ready" : status.readyToUse === false ? "Pending" : "Unknown";
    const snapshotRef = asRecord(spec.volumeSnapshotRef);
    const snapshotClaim =
      snapshotRef && typeof snapshotRef.name === "string"
        ? `${String(snapshotRef.namespace ?? "cluster")}/${snapshotRef.name}`
        : "-";
    const snapshotDriver = String(spec.driver ?? item.driver ?? "-");
    const snapshotDeletionPolicy = String(spec.deletionPolicy ?? item.deletionPolicy ?? "-");
    const annotations = asRecord(metadata.annotations);
    const snapshotClassDefault =
      String(annotations["snapshot.storage.kubernetes.io/is-default-class"] ?? "").toLowerCase() ===
      "true";
    const csiStorageClass = String(item.storageClassName ?? spec.storageClassName ?? "-");
    const csiCapacity = String(item.maximumVolumeSize ?? item.capacity ?? "-");
    const workloadStatus =
      workloadKey === "horizontalpodautoscalers"
        ? hpaStatus
        : workloadKey === "replicationcontrollers"
          ? String(status.readyReplicas ?? spec.replicas ?? "0")
          : workloadKey === "services"
            ? serviceType === "LoadBalancer"
              ? serviceLoadBalancerIngress.length > 0
                ? "Ready"
                : "Pending"
              : "Active"
            : workloadKey === "persistentvolumeclaims" || workloadKey === "persistentvolumes"
              ? phase
              : workloadKey === "volumesnapshots"
                ? snapshotReady
                : workloadKey === "volumesnapshotcontents"
                  ? String(
                      status.readyToUse === true
                        ? "Ready"
                        : status.readyToUse === false
                          ? "Pending"
                          : (status.phase ?? "Unknown"),
                    )
                  : workloadKey === "endpointslices"
                    ? endpointSliceNotReadyCount > 0
                      ? "Degraded"
                      : endpointSliceReadyCount > 0
                        ? "Ready"
                        : "Empty"
                    : String(status.phase ?? "-");
    const isDefaultStorageClass =
      String(
        annotations["storageclass.kubernetes.io/is-default-class"] ??
          annotations["storageclass.beta.kubernetes.io/is-default-class"] ??
          "",
      ).toLowerCase() === "true";
    const rbacRiskScore = evaluateRbacRisk(workloadKey, item).scoreDelta;
    const driftDetected = hasLastAppliedDrift(item);
    return {
      uid: uidCandidate || `${namespace}/${name}/${index}`,
      problemScore: buildConfigurationProblemScore(item) + (driftDetected ? 90 : 0) + rbacRiskScore,
      name,
      namespace,
      createdAt: getCreatedAt(item),
      age: getCreatedAt(item) ? getTimeDifference(new Date(getCreatedAt(item))) : "-",
      keys,
      labels,
      type,
      handler,
      holder,
      webhooks,
      status: workloadStatus,
      minAvailable: pdbMinAvailable,
      maxUnavailable: pdbMaxUnavailable,
      currentHealthy: pdbCurrentHealthy,
      desiredHealthy: pdbDesiredHealthy,
      metrics: hpaMetrics,
      minPods: hpaMinPods,
      maxPods: hpaMaxPods,
      replicas:
        workloadKey === "replicationcontrollers"
          ? `${String(status.readyReplicas ?? 0)}/${String(spec.replicas ?? 0)}`
          : hpaReplicas,
      bindings,
      resource,
      group,
      version,
      scope,
      kind,
      controller,
      apiGroup,
      externalIP,
      selector:
        workloadKey === "replicationcontrollers"
          ? Object.entries(asRecord(spec.selector))
              .map(([key, value]) => `${key}=${String(value)}`)
              .join(", ") || "-"
          : selector,
      endpoints,
      loadBalancers,
      policyTypes,
      storageClass:
        workloadKey === "persistentvolumeclaims"
          ? pvcStorageClass
          : workloadKey === "persistentvolumes"
            ? pvStorageClass
            : workloadKey === "volumesnapshots"
              ? snapshotStorageClass
              : workloadKey === "csistoragecapacities"
                ? csiStorageClass
                : workloadKey === "storageclasses"
                  ? name
                  : "-",
      size:
        workloadKey === "persistentvolumeclaims"
          ? pvcSize
          : workloadKey === "volumesnapshots" || workloadKey === "volumesnapshotcontents"
            ? snapshotRestoreSize
            : "-",
      pods: workloadKey === "persistentvolumeclaims" ? pvcPods : "-",
      capacity:
        workloadKey === "persistentvolumes"
          ? pvCapacity
          : workloadKey === "csistoragecapacities"
            ? csiCapacity
            : "-",
      resourceVersion,
      rbacRiskScore,
      value: priorityValue,
      globalDefault: workloadKey === "volumesnapshotclasses" ? snapshotClassDefault : globalDefault,
      serviceType,
      clusterIP,
      ports,
      phase,
      storage,
      claim: workloadKey === "volumesnapshotcontents" ? snapshotClaim : claim,
      provisioner:
        workloadKey === "volumesnapshotcontents" || workloadKey === "volumesnapshotclasses"
          ? snapshotDriver
          : provisioner,
      reclaimPolicy:
        workloadKey === "volumesnapshotcontents" || workloadKey === "volumesnapshotclasses"
          ? snapshotDeletionPolicy
          : reclaimPolicy,
      isDefaultStorageClass:
        workloadKey === "volumesnapshotclasses" ? snapshotClassDefault : isDefaultStorageClass,
      driftDetected,
      details: describeDetails(item),
      raw: item,
    };
  }

  function loadRowsFromProps() {
    const items = Array.isArray(data.items) ? data.items : [];
    rowsSnapshot = items.map((item, index) => toRow(item, index));
    if (clusterId && workloadKey) {
      lastWatcherSuccessAt = Date.now();
      markConfigurationSyncSuccess(clusterId, workloadKey);
    }
  }

  function applyItemsSnapshot(items: GenericItem[]) {
    rowsSnapshot = items.map((item, index) => toRow(item, index));
    if (clusterId && workloadKey) {
      lastWatcherSuccessAt = Date.now();
      markConfigurationSyncSuccess(clusterId, workloadKey);
    }
  }

  const shouldUseConfigurationRowsWorker = $derived(
    ENABLE_CONFIGURATION_ROWS_WORKER &&
      !configurationRowsWorkerDisabled &&
      rowsSnapshot.length >= CONFIGURATION_ROWS_WORKER_THRESHOLD,
  );

  const inlineFilteredRows = $derived.by(() => {
    return computeConfigurationRows(rowsSnapshot, {
      selectedNamespaces: [...selectedNamespaces],
      search,
      quickFilter,
      sortBy,
      sortDirection,
    });
  });

  const filteredRows = $derived.by(() => {
    if (!shouldUseConfigurationRowsWorker || !configurationRowsWorker) return inlineFilteredRows;
    if (!configurationRowsWorkerResult) return inlineFilteredRows;
    return configurationRowsWorkerResult
      .map((row) => rowsSnapshotByUid.get(row.uid))
      .filter((row): row is ConfigurationRow => Boolean(row));
  });
  const groupedRows = $derived.by(() => {
    if (viewMode === "flat") return [] as Array<[string, ConfigurationRow[]]>;
    const groups = new Map<string, ConfigurationRow[]>();
    for (const row of filteredRows) {
      const bucket = groups.get(row.namespace) ?? [];
      bucket.push(row);
      groups.set(row.namespace, bucket);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  });
  const filteredRowsByNamespace = $derived.by(() => {
    const groups = new Map<string, ConfigurationRow[]>();
    for (const row of filteredRows) {
      const bucket = groups.get(row.namespace) ?? [];
      bucket.push(row);
      groups.set(row.namespace, bucket);
    }
    return groups;
  });
  const groupKeys = $derived(groupedRows.map(([group]) => `namespace:${group}`));
  const hasGroupedRows = $derived(viewMode !== "flat" && groupedRows.length > 0);
  const configTotalPages = $derived(calcTotalPages(filteredRows.length, configPageSize));
  const paginatedRows = $derived(
    filteredRows.slice(configPageIndex * configPageSize, (configPageIndex + 1) * configPageSize),
  );
  const shouldVirtualizeFlatRows = $derived(
    viewMode === "flat" && paginatedRows.length >= VIRTUALIZATION_THRESHOLD,
  );
  const flatVirtualWindow = $derived.by(() => {
    if (!shouldVirtualizeFlatRows) {
      return {
        startIndex: 0,
        endIndex: paginatedRows.length,
        paddingTop: 0,
        paddingBottom: 0,
      };
    }
    return computeVirtualWindow({
      totalCount: paginatedRows.length,
      rowHeight: VIRTUALIZATION_ROW_HEIGHT,
      viewportHeight: tableViewportHeight,
      scrollTop: tableScrollTop,
      overscan: VIRTUALIZATION_OVERSCAN,
    });
  });
  const flatVisibleRows = $derived(
    paginatedRows.slice(flatVirtualWindow.startIndex, flatVirtualWindow.endIndex),
  );
  const availableNamespaces = $derived(
    [...new Set(rowsSnapshot.map((row) => row.namespace))].sort((a, b) => a.localeCompare(b)),
  );
  const namespaceEntries = $derived(
    availableNamespaces.map((namespace) => ({
      id: namespace,
      label: namespace,
      checked: selectedNamespaces.has(namespace),
    })),
  );

  function getNamespaceFilteredRows() {
    return rowsSnapshot.filter((row) => selectedNamespaces.has(row.namespace));
  }

  function getNamespaceRows(group: string) {
    return filteredRowsByNamespace.get(group) ?? [];
  }

  function quickFilterOptions() {
    const options: Array<{ id: QuickFilterId; label: string }> = [
      { id: "all", label: "All" },
      { id: "problems", label: "Problems" },
      { id: "drifted", label: "Drifted" },
    ];
    if (
      workloadKey === "persistentvolumeclaims" ||
      workloadKey === "persistentvolumes" ||
      workloadKey === "volumesnapshotcontents"
    ) {
      options.push({ id: "unbound", label: "Unbound" });
    }
    if (workloadKey === "ingresses") {
      options.push({ id: "no-ingress-rules", label: "No ingress rules" });
    }
    if (workloadKey === "networkpolicies") {
      options.push({ id: "no-policy-types", label: "No policy types" });
    }
    if (workloadKey === "storageclasses" || workloadKey === "volumesnapshotclasses") {
      options.push({ id: "default-storageclass", label: "Default class" });
    }
    if (workloadKey === "rolebindings" || workloadKey === "clusterrolebindings") {
      options.push({ id: "no-subjects", label: "No subjects" });
    }
    if (workloadKey === "roles" || workloadKey === "clusterroles") {
      options.push({ id: "wildcard-rules", label: "Wildcard rules" });
    }
    if (workloadKey === "customresourcedefinitions") {
      options.push({ id: "crd-non-structural", label: "Non-structural" });
      options.push({ id: "crd-deprecated-versions", label: "Deprecated versions" });
    }
    if (workloadKey === "persistentvolumes" || workloadKey === "volumesnapshotcontents") {
      options.push({ id: "orphan-pv", label: "Orphan PV" });
    }
    return options;
  }

  function loadSavedViewsForScope() {
    const all = listSavedViews();
    savedViews = all
      .filter((view) => view.clusterId === clusterId && view.workload === workloadKey)
      .map((view) => ({ id: view.id, name: view.name }));
  }

  function applySavedView(viewId: string) {
    const all = listSavedViews();
    const view = all.find((entry) => entry.id === viewId);
    if (!view) return;
    searchInput = view.query;
    search = view.query;
    sortBy = view.sortBy as SortBy;
    sortDirection = view.sortDirection;
    const nextColumns = { ...columnsVisible };
    for (const key of Object.keys(nextColumns) as Array<keyof ColumnVisibilityState>) {
      nextColumns[key] = view.columns.includes(key);
    }
    columnsVisible = nextColumns;
  }

  function setSearchQuery(value: string) {
    searchInput = value;
    applySearchDebounced(value);
  }

  function syncTableViewport() {
    if (!tableScrollHost) return;
    tableViewportHeight = Math.max(1, tableScrollHost.clientHeight);
  }

  function handleTableScroll(event: Event) {
    const target = event.currentTarget as HTMLDivElement | null;
    tableScrollTop = target?.scrollTop ?? 0;
  }

  function startConfigurationRowsWorker() {
    if (typeof window === "undefined") return;
    if (typeof Worker === "undefined") return;
    if (!ENABLE_CONFIGURATION_ROWS_WORKER) return;
    if (configurationRowsWorkerDisabled) return;
    if (configurationRowsWorker) return;
    configurationRowsWorker = new Worker(
      new URL("./model/configuration-rows.worker.ts", import.meta.url),
      {
        type: "module",
      },
    );
    trackWorkloadEvent("workloads.worker_started", {
      worker: "configuration_rows",
      workload: workloadKey,
    });
    configurationRowsWorker.onmessage = (
      event: MessageEvent<{
        id: number;
        enqueuedAt: number;
        startedAt: number;
        finishedAt: number;
        rows: ConfigurationRow[];
      }>,
    ) => {
      const payload = event.data;
      if (!payload || payload.id !== configurationRowsWorkerRequestId) return;
      configurationRowsWorkerFailures = 0;
      configurationRowsWorkerResult = payload.rows;
      const queueMs = Math.max(0, payload.startedAt - payload.enqueuedAt);
      const computeMs = Math.max(0, payload.finishedAt - payload.startedAt);
      trackWorkloadEvent("workloads.worker_queue_ms", {
        worker: "configuration_rows",
        workload: workloadKey,
        durationMs: queueMs,
        queueMs,
      });
      trackWorkloadEvent("workloads.worker_compute_ms", {
        worker: "configuration_rows",
        workload: workloadKey,
        durationMs: computeMs,
        computeMs,
      });
    };
    configurationRowsWorker.onerror = () => {
      configurationRowsWorkerFailures += 1;
      trackWorkloadEvent("workloads.worker_error", {
        worker: "configuration_rows",
        workload: workloadKey,
        failures: configurationRowsWorkerFailures,
      });
      if (configurationRowsWorkerFailures >= 2) {
        configurationRowsWorkerDisabled = true;
        stopConfigurationRowsWorker();
        trackWorkloadEvent("workloads.worker_auto_rollback", {
          worker: "configuration_rows",
          workload: workloadKey,
        });
      }
    };
  }

  function stopConfigurationRowsWorker() {
    if (!configurationRowsWorker) return;
    configurationRowsWorker.terminate();
    configurationRowsWorker = null;
    configurationRowsWorkerResult = null;
    trackWorkloadEvent("workloads.worker_stopped", {
      worker: "configuration_rows",
      workload: workloadKey,
    });
  }

  function scheduleConfigurationRowsWorker() {
    if (!configurationRowsWorker) return;
    configurationRowsWorkerRequestId += 1;
    const requestId = configurationRowsWorkerRequestId;
    // Keep cached/inline rows visible until the newest worker result arrives.
    configurationRowsWorkerResult = null;
    try {
      configurationRowsWorker.postMessage({
        id: requestId,
        enqueuedAt: Date.now(),
        rows: rowsSnapshot.map(({ raw: _raw, ...row }) => row),
        selectedNamespaces: [...selectedNamespaces],
        search,
        quickFilter,
        sortBy,
        sortDirection,
      });
    } catch {
      configurationRowsWorkerFailures += 1;
      configurationRowsWorkerDisabled = true;
      stopConfigurationRowsWorker();
      trackWorkloadEvent("workloads.worker_auto_rollback", {
        worker: "configuration_rows",
        workload: workloadKey,
        reason: "post_message_failed",
      });
    }
  }

  function saveCurrentView() {
    const name = newSavedViewName.trim();
    if (!name) {
      errorMessage = "Enter view name.";
      return;
    }
    const id = `${clusterId}:${workloadKey}:${name.toLowerCase().replaceAll(/\s+/g, "-")}`;
    const visibleColumns = (
      Object.keys(columnsVisible) as Array<keyof ColumnVisibilityState>
    ).filter((key) => columnsVisible[key]);
    upsertSavedView({
      id,
      name,
      workload: workloadKey,
      clusterId,
      query: search,
      columns: visibleColumns,
      sortBy,
      sortDirection,
    });
    newSavedViewName = "";
    loadSavedViewsForScope();
    actionNotification = notifySuccess(`Saved view: ${name}`);
  }

  function removeSavedView() {
    if (!selectedSavedViewId) return;
    deleteSavedView(selectedSavedViewId);
    selectedSavedViewId = "";
    loadSavedViewsForScope();
    actionNotification = notifySuccess("Saved view deleted.");
  }

  async function copyShareLink() {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("workload", workloadKey);
    if (search.trim()) url.searchParams.set("q", search.trim());
    url.searchParams.set("sort", sortBy);
    url.searchParams.set("dir", sortDirection);
    url.searchParams.set("quick", quickFilter);
    url.searchParams.set("view", viewMode);
    await copyTextToClipboard(url.toString(), "Share link copied.");
  }

  function isGroupCollapsed(group: string) {
    return collapsedGroups.has(`namespace:${group}`);
  }

  function toggleGroup(group: string) {
    const id = `namespace:${group}`;
    const next = new Set(collapsedGroups);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsedGroups = next;
  }

  function toggleAllGroups() {
    collapsedGroups = toggleAllGroupsCollapsed(collapsedGroups, groupKeys);
  }

  function toggleNamespace(namespace: string, checked: boolean) {
    const next = new Set(selectedNamespaces);
    if (checked) next.add(namespace);
    else next.delete(namespace);
    selectedNamespaces = next;
  }

  function selectAllNamespaces() {
    selectedNamespaces = new Set(availableNamespaces);
  }

  function clearAllNamespaces() {
    selectedNamespaces = new Set();
  }

  function toCsvCell(value: unknown) {
    if (value === null || value === undefined) return "";
    const text = String(value).replaceAll('"', '""');
    return `"${text}"`;
  }

  async function copyTextToClipboard(text: string, successMessage: string) {
    if (typeof window === "undefined") return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      actionNotification = notifySuccess(successMessage);
    } catch {
      errorMessage = "Failed to copy to clipboard.";
    }
  }

  async function exportDebugBundle(text: string, parts: string[], successMessage: string) {
    if (!text.trim()) return;
    try {
      const filename = buildTextExportFilename("support", parts, "txt");
      const result = await exportTextArtifact({ filename, text });
      actionNotification = notifySuccess(`${successMessage} Saved to ${result.pathHint}.`);
    } catch {
      errorMessage = "Failed to export debug bundle.";
    }
  }

  function buildGetYamlCommand(row: ConfigurationRow) {
    const resource = resourceByWorkload[workloadKey] ?? workloadKey;
    return buildKubectlGetYamlCliCommand({
      resource,
      name: row.name,
      namespace: row.namespace,
      namespaceScoped: isNamespaceScoped && row.namespace !== "cluster",
    });
  }

  function buildDescribeCommand(row: ConfigurationRow) {
    const resource = resourceByWorkload[workloadKey] ?? workloadKey;
    return buildKubectlDescribeCliCommand({
      resource,
      name: row.name,
      namespace: row.namespace,
      namespaceScoped: isNamespaceScoped && row.namespace !== "cluster",
    });
  }

  function openDebugDescribeForRow(row: ConfigurationRow) {
    const resource = resourceByWorkload[workloadKey] ?? workloadKey;
    runDebugDescribe({
      clusterId,
      resource,
      name: row.name,
      namespace: isNamespaceScoped && row.namespace !== "cluster" ? row.namespace : undefined,
      title: `Describe ${getDetailsResourceLabel().toLowerCase()} ${row.namespace}/${row.name}`,
    });
    actionNotification = notifySuccess(`Opened debug describe for ${row.namespace}/${row.name}.`);
    errorMessage = null;
  }

  async function downloadCsv() {
    const headers = [
      "name",
      ...(columnsVisible.namespace ? ["namespace"] : []),
      ...(columnsVisible.createdAt ? ["age"] : []),
      ...(columnsVisible.keys ? ["keys"] : []),
      ...(columnsVisible.labels ? ["labels"] : []),
      ...(columnsVisible.type ? ["type"] : []),
      ...(columnsVisible.handler ? ["handler"] : []),
      ...(columnsVisible.holder ? ["holder"] : []),
      ...(columnsVisible.webhooks ? ["webhooks"] : []),
      ...(columnsVisible.status ? ["status"] : []),
      ...(columnsVisible.minAvailable ? ["minAvailable"] : []),
      ...(columnsVisible.maxUnavailable ? ["maxUnavailable"] : []),
      ...(columnsVisible.currentHealthy ? ["currentHealthy"] : []),
      ...(columnsVisible.desiredHealthy ? ["desiredHealthy"] : []),
      ...(columnsVisible.metrics ? ["metrics"] : []),
      ...(columnsVisible.minPods ? ["minPods"] : []),
      ...(columnsVisible.maxPods ? ["maxPods"] : []),
      ...(columnsVisible.replicas ? ["replicas"] : []),
      ...(columnsVisible.bindings ? ["bindings"] : []),
      ...(columnsVisible.resource ? ["resource"] : []),
      ...(columnsVisible.group ? ["group"] : []),
      ...(columnsVisible.version ? ["version"] : []),
      ...(columnsVisible.scope ? ["scope"] : []),
      ...(columnsVisible.kind ? ["kind"] : []),
      ...(columnsVisible.controller ? ["controller"] : []),
      ...(columnsVisible.apiGroup ? ["apiGroup"] : []),
      ...(columnsVisible.externalIP ? ["externalIP"] : []),
      ...(columnsVisible.selector ? ["selector"] : []),
      ...(columnsVisible.endpoints ? ["endpoints"] : []),
      ...(columnsVisible.loadBalancers ? ["loadBalancers"] : []),
      ...(columnsVisible.policyTypes ? ["policyTypes"] : []),
      ...(columnsVisible.storageClass ? ["storageClass"] : []),
      ...(columnsVisible.size ? ["size"] : []),
      ...(columnsVisible.pods ? ["pods"] : []),
      ...(columnsVisible.capacity ? ["capacity"] : []),
      ...(columnsVisible.serviceType ? ["serviceType"] : []),
      ...(columnsVisible.clusterIP ? ["clusterIP"] : []),
      ...(columnsVisible.ports ? ["portsOrRules"] : []),
      ...(columnsVisible.phase ? ["status"] : []),
      ...(columnsVisible.storage ? ["storage"] : []),
      ...(columnsVisible.claim ? ["claim"] : []),
      ...(columnsVisible.provisioner ? ["provisioner"] : []),
      ...(columnsVisible.reclaimPolicy ? ["reclaimPolicy"] : []),
      ...(columnsVisible.isDefaultStorageClass ? ["defaultStorageClass"] : []),
      ...(columnsVisible.resourceVersion ? ["resourceVersion"] : []),
      ...(columnsVisible.value ? ["value"] : []),
      ...(columnsVisible.globalDefault ? ["globalDefault"] : []),
    ];
    const lines = [headers.map(toCsvCell).join(",")];
    for (const row of filteredRows) {
      const values = [
        row.name,
        ...(columnsVisible.namespace ? [row.namespace] : []),
        ...(columnsVisible.createdAt ? [row.age] : []),
        ...(columnsVisible.keys ? [row.keys] : []),
        ...(columnsVisible.labels ? [row.labels] : []),
        ...(columnsVisible.type ? [row.type] : []),
        ...(columnsVisible.handler ? [row.handler] : []),
        ...(columnsVisible.holder ? [row.holder] : []),
        ...(columnsVisible.webhooks ? [row.webhooks] : []),
        ...(columnsVisible.status ? [row.status] : []),
        ...(columnsVisible.minAvailable ? [row.minAvailable] : []),
        ...(columnsVisible.maxUnavailable ? [row.maxUnavailable] : []),
        ...(columnsVisible.currentHealthy ? [row.currentHealthy] : []),
        ...(columnsVisible.desiredHealthy ? [row.desiredHealthy] : []),
        ...(columnsVisible.metrics ? [row.metrics] : []),
        ...(columnsVisible.minPods ? [row.minPods] : []),
        ...(columnsVisible.maxPods ? [row.maxPods] : []),
        ...(columnsVisible.replicas ? [row.replicas] : []),
        ...(columnsVisible.bindings ? [row.bindings] : []),
        ...(columnsVisible.resource ? [row.resource] : []),
        ...(columnsVisible.group ? [row.group] : []),
        ...(columnsVisible.version ? [row.version] : []),
        ...(columnsVisible.scope ? [row.scope] : []),
        ...(columnsVisible.kind ? [row.kind] : []),
        ...(columnsVisible.controller ? [row.controller] : []),
        ...(columnsVisible.apiGroup ? [row.apiGroup] : []),
        ...(columnsVisible.externalIP ? [row.externalIP] : []),
        ...(columnsVisible.selector ? [row.selector] : []),
        ...(columnsVisible.endpoints ? [row.endpoints] : []),
        ...(columnsVisible.loadBalancers ? [row.loadBalancers] : []),
        ...(columnsVisible.policyTypes ? [row.policyTypes] : []),
        ...(columnsVisible.storageClass ? [row.storageClass] : []),
        ...(columnsVisible.size ? [row.size] : []),
        ...(columnsVisible.pods ? [row.pods] : []),
        ...(columnsVisible.capacity ? [row.capacity] : []),
        ...(columnsVisible.serviceType ? [row.serviceType] : []),
        ...(columnsVisible.clusterIP ? [row.clusterIP] : []),
        ...(columnsVisible.ports ? [row.ports] : []),
        ...(columnsVisible.phase ? [row.phase] : []),
        ...(columnsVisible.storage ? [row.storage] : []),
        ...(columnsVisible.claim ? [row.claim] : []),
        ...(columnsVisible.provisioner ? [row.provisioner] : []),
        ...(columnsVisible.reclaimPolicy ? [row.reclaimPolicy] : []),
        ...(columnsVisible.isDefaultStorageClass
          ? [row.isDefaultStorageClass ? "true" : "false"]
          : []),
        ...(columnsVisible.resourceVersion ? [row.resourceVersion] : []),
        ...(columnsVisible.value ? [row.value] : []),
        ...(columnsVisible.globalDefault ? [row.globalDefault ? "true" : "false"] : []),
      ];
      lines.push(values.map(toCsvCell).join(","));
    }
    const csv = lines.join("\n");
    const filename = `${workloadKey || "configuration"}.csv`;
    const result = await exportCsvArtifact({ filename, csv });
    actionNotification = notifySuccess(
      `CSV exported: ${result.pathHint} (${filteredRows.length} rows).`,
    );
  }

  function resetWatcherSettings() {
    watcherEnabled = DEFAULT_WATCHER_SETTINGS.enabled;
    watcherRefreshSeconds = DEFAULT_WATCHER_SETTINGS.refreshSeconds;
    viewMode = DEFAULT_WATCHER_SETTINGS.viewMode;
    persistWatcherSettings();
    applyWatcherMode();
  }

  function toggleWorkbenchFullscreen() {
    const next = !workbenchFullscreen;
    workbenchFullscreen = next;
    if (next) workbenchCollapsed = false;
  }

  function toggleWorkbenchCollapse() {
    workbenchCollapsed = !workbenchCollapsed;
    if (workbenchCollapsed && workbenchFullscreen) {
      workbenchFullscreen = false;
    }
  }

  function setWorkbenchLayout(layout: WorkbenchLayout) {
    workbenchLayout = layout;
    if (layout === "single") {
      setPaneTabIdsIfChanged([null, null, null]);
      setCollapsedPaneIndexesIfChanged([]);
      yamlComparePair = null;
      yamlCompareTargetTabId = null;
      return;
    }
    const next: [string | null, string | null, string | null] = [...paneTabIds];
    const ids = orderedWorkbenchTabs.map((tab) => tab.id);
    const used = new Set<string>();
    for (let idx = 0; idx < 3; idx += 1) {
      if (next[idx] && !ids.includes(next[idx] as string)) next[idx] = null;
      if (next[idx]) used.add(next[idx] as string);
    }
    if (!next[0] && activeWorkbenchTabId) {
      next[0] = activeWorkbenchTabId;
      used.add(activeWorkbenchTabId);
    }
    for (let idx = 1; idx < (layout === "dual" ? 2 : 3); idx += 1) {
      if (next[idx]) continue;
      const candidate = ids.find((id) => !used.has(id)) ?? null;
      next[idx] = candidate;
      if (candidate) used.add(candidate);
    }
    if (layout === "dual") next[2] = null;
    setPaneTabIdsIfChanged(next);
    setCollapsedPaneIndexesIfChanged(collapsedPaneIndexes.filter((idx) => idx < getPaneCount()));
  }

  async function requestWorkbenchLayout(nextLayout: WorkbenchLayout) {
    if (nextLayout === workbenchLayout) return;
    const currentPaneCount = getPaneCount();
    const nextPaneCount = nextLayout === "single" ? 1 : nextLayout === "dual" ? 2 : 3;
    if (nextPaneCount >= currentPaneCount) {
      setWorkbenchLayout(nextLayout);
      return;
    }
    const { occupiedRemovedPaneCount, tabsToClose } = computeLayoutClosePlan(
      paneTabIds,
      nextPaneCount,
    );
    if (occupiedRemovedPaneCount === 0) {
      setWorkbenchLayout(nextLayout);
      return;
    }
    const confirmed = await confirmWorkbenchLayoutShrink();
    if (!confirmed) return;
    for (const tabId of tabsToClose) await closeWorkbenchTab(tabId, { skipConfirm: true });
    setWorkbenchLayout(nextLayout);
  }

  const selectedRows = $derived(filteredRows.filter((row) => selectedRowIds.has(row.uid)));
  const selectedRowsDeletable = $derived(selectedRows.filter((row) => canDeleteNamespaceRow(row)));
  const selectedRowsBlockedByPolicy = $derived(
    selectedRows.filter((row) => !canDeleteNamespaceRow(row)),
  );
  const orderedWorkbenchTabs = $derived.by(() => orderPinnedTabs(workbenchTabs, pinnedTabIds));
  const hasWorkbenchTabs = $derived(orderedWorkbenchTabs.length > 0);
  const activeWorkbenchTab = $derived(
    activeWorkbenchTabId
      ? (workbenchTabs.find((tab) => tab.id === activeWorkbenchTabId) ?? null)
      : null,
  );
  const activeYamlTab = $derived(
    activeWorkbenchTab?.kind === "yaml" ? getYamlTab(activeWorkbenchTab.id) : null,
  );
  const bulkMode = $derived((selectedRows.length === 1 ? "single" : "multi") as "single" | "multi");
  const bulkDisabled = $derived(selectedRows.length === 0 || actionInFlight);
  const allVisibleSelected = $derived(
    filteredRows.length > 0 && filteredRows.every((row) => selectedRowIds.has(row.uid)),
  );
  const someVisibleSelected = $derived(
    filteredRows.some((row) => selectedRowIds.has(row.uid)) && !allVisibleSelected,
  );
  const visibleDataColumnCount = $derived(
    Number(columnsVisible.name) +
      Number(columnsVisible.namespace) +
      Number(columnsVisible.createdAt) +
      Number(columnsVisible.keys) +
      Number(columnsVisible.labels) +
      Number(columnsVisible.type) +
      Number(columnsVisible.handler) +
      Number(columnsVisible.holder) +
      Number(columnsVisible.webhooks) +
      Number(columnsVisible.status) +
      Number(columnsVisible.minAvailable) +
      Number(columnsVisible.maxUnavailable) +
      Number(columnsVisible.currentHealthy) +
      Number(columnsVisible.desiredHealthy) +
      Number(columnsVisible.metrics) +
      Number(columnsVisible.minPods) +
      Number(columnsVisible.maxPods) +
      Number(columnsVisible.replicas) +
      Number(columnsVisible.bindings) +
      Number(columnsVisible.resource) +
      Number(columnsVisible.group) +
      Number(columnsVisible.version) +
      Number(columnsVisible.scope) +
      Number(columnsVisible.kind) +
      Number(columnsVisible.controller) +
      Number(columnsVisible.apiGroup) +
      Number(columnsVisible.externalIP) +
      Number(columnsVisible.selector) +
      Number(columnsVisible.endpoints) +
      Number(columnsVisible.loadBalancers) +
      Number(columnsVisible.policyTypes) +
      Number(columnsVisible.storageClass) +
      Number(columnsVisible.size) +
      Number(columnsVisible.pods) +
      Number(columnsVisible.capacity) +
      Number(columnsVisible.serviceType) +
      Number(columnsVisible.clusterIP) +
      Number(columnsVisible.ports) +
      Number(columnsVisible.phase) +
      Number(columnsVisible.storage) +
      Number(columnsVisible.claim) +
      Number(columnsVisible.provisioner) +
      Number(columnsVisible.reclaimPolicy) +
      Number(columnsVisible.isDefaultStorageClass) +
      Number(columnsVisible.resourceVersion) +
      Number(columnsVisible.value) +
      Number(columnsVisible.globalDefault),
  );

  function deleteSelectedRows() {
    if (selectedRowsDeletable.length === 0) {
      if (isNamespacesWorkload && selectedRowsBlockedByPolicy.length > 0) {
        errorMessage = "Selected namespaces are protected and cannot be deleted.";
      }
      return;
    }
    void deleteRows(selectedRowsDeletable);
  }
  const watcherStaleThresholdMs = $derived(
    normalizeWatcherRefreshSeconds(watcherRefreshSeconds) * 2000,
  );
  const watcherFreshnessAgeMs = $derived(
    lastWatcherSuccessAt ? freshnessNow - lastWatcherSuccessAt : Number.POSITIVE_INFINITY,
  );
  const watcherIsStale = $derived(
    watcherEnabled &&
      Number.isFinite(watcherFreshnessAgeMs) &&
      watcherFreshnessAgeMs > watcherStaleThresholdMs,
  );
  const configurationRuntimeProfileLabel = $derived(
    `${getDashboardDataProfileDisplayName($dashboardDataProfile)} profile`,
  );
  const configurationRuntimeSectionLabel = $derived(`${tableTitle} Runtime Status`);
  const configurationRuntimeSubjectLabel = $derived.by(() => {
    return tableTitle.toLowerCase();
  });
  const configurationScopeSummary = $derived.by(() => {
    if (isNamespacesWorkload) return "Cluster-scoped";
    return configurationNamespaceSummary;
  });
  const configurationRuntimeSourceState = $derived.by(() => {
    if (!watcherEnabled) return "paused";
    if (watcherError && rowsSnapshot.length > 0) return "cached";
    if (watcherError) return "error";
    if (watcherIsStale) return "stale";
    if (watcherInFlight && rowsSnapshot.length > 0) return "cached";
    if (lastWatcherSuccessAt) return "live";
    if (rowsSnapshot.length > 0) return "cached";
    return "idle";
  });
  const configurationRuntimeDetail = $derived.by(() => {
    if (!watcherEnabled)
      return `${tableTitle} sync is paused until you refresh or re-enable the watcher.`;
    if (watcherError && rowsSnapshot.length > 0) {
      return `Showing the last successful ${configurationRuntimeSubjectLabel} snapshot while background refresh is degraded.`;
    }
    if (watcherError) return `${tableTitle} sync is degraded and needs operator attention.`;
    if (watcherIsStale)
      return `${tableTitle} data has exceeded the freshness budget and should be refreshed.`;
    if (watcherInFlight)
      return `Background ${configurationRuntimeSubjectLabel} refresh is currently in flight.`;
    return `${tableTitle} sync is operating within the current runtime budget.`;
  });
  const configurationRuntimeReason = $derived.by(() => {
    if (watcherError) return watcherError;
    if (isNamespacesWorkload) {
      return `Scope: cluster inventory. ${watcherPolicy.mode === "stream" ? "Streaming watcher active for namespaces." : `Polling namespaces every ${watcherPolicy.refreshSeconds}s.`}`;
    }
    const namespaceScope =
      selectedNamespaces.size > 0
        ? `${selectedNamespaces.size} namespaces selected`
        : "all namespaces";
    return `Scope: ${namespaceScope}. ${watcherPolicy.mode === "stream" ? `Streaming watcher active for ${configurationRuntimeSubjectLabel}.` : `Polling ${configurationRuntimeSubjectLabel} every ${watcherPolicy.refreshSeconds}s.`}`;
  });
  const configurationNamespaceSummary = $derived.by(() => {
    return selectedNamespaces.size > 0 ? `${selectedNamespaces.size} selected` : "all namespaces";
  });
  const configurationSummaryView = $derived.by(() => {
    return viewMode === "namespace" ? "Grouped by namespace" : "Flat";
  });

  function getYamlTab(tabId: string | null) {
    if (!tabId) return null;
    return yamlTabs.find((tab) => tab.id === tabId) ?? null;
  }

  function getPortForwardTab(tabId: string | null) {
    if (!tabId) return null;
    return portForwardTabs.find((tab) => tab.id === tabId) ?? null;
  }

  function updatePortForwardTab(
    tabId: string,
    updater: (tab: PortForwardBrowserTabState) => PortForwardBrowserTabState,
  ) {
    portForwardTabs = portForwardTabs.map((tab) => (tab.id === tabId ? updater(tab) : tab));
  }

  $effect(() => {
    if (workloadKey !== "services") return;
    const runningForwards = Object.entries($activePortForwards)
      .map(([key, forward]) => ({ key, forward }))
      .filter(
        (entry): entry is { key: string; forward: PortForwardProcess } =>
          entry.forward !== undefined &&
          clusterIds.includes(entry.forward.clusterId) &&
          entry.forward.isRunning,
      );
    const serviceForwards = runningForwards
      .map((entry) => {
        const match = /^svc\/(.+)$/.exec(entry.forward.resource);
        if (!match) return null;
        return { ...entry, serviceName: match[1] };
      })
      .filter((entry): entry is { key: string; forward: PortForwardProcess; serviceName: string } =>
        Boolean(entry),
      );
    const resolvedServiceForwards = selectLatestPortForwardsByTabId(serviceForwards, (entry) => {
      return `port-forward:${entry.forward.namespace}/${entry.serviceName}`;
    });

    const activeKeys = new Set(resolvedServiceForwards.map((entry) => entry.key));
    const filteredPortForwardTabs = portForwardTabs.filter((tab) => activeKeys.has(tab.uniqueKey));
    if (filteredPortForwardTabs.length !== portForwardTabs.length) {
      portForwardTabs = filteredPortForwardTabs;
    }
    const filteredWorkbenchTabs = workbenchTabs.filter((tab) =>
      tab.kind === "port-forward" ? Boolean(getPortForwardTab(tab.id)) : true,
    );
    if (filteredWorkbenchTabs.length !== workbenchTabs.length) {
      workbenchTabs = filteredWorkbenchTabs;
    }

    for (const { key, forward, serviceName } of resolvedServiceForwards) {
      const tabId = `port-forward:${forward.namespace}/${serviceName}`;
      const url = `${forward.remotePort === 443 || forward.remotePort === 8443 ? "https" : "http"}://127.0.0.1:${forward.localPort}`;
      const existing = getPortForwardTab(tabId);
      if (!existing) {
        portForwardTabs = [
          ...portForwardTabs,
          {
            id: tabId,
            target: {
              name: serviceName,
              namespace: forward.namespace,
              remotePort: forward.remotePort,
              localPort: forward.localPort,
            },
            uniqueKey: key,
            url,
            loading: false,
            statusMessage: `Forwarding ${forward.localPort}:${forward.remotePort}`,
          },
        ];
      } else {
        const nextMessage = `Forwarding ${forward.localPort}:${forward.remotePort}`;
        if (
          existing.uniqueKey !== key ||
          existing.url !== url ||
          existing.loading ||
          existing.statusMessage !== nextMessage ||
          existing.target.namespace !== forward.namespace ||
          existing.target.name !== serviceName ||
          existing.target.remotePort !== forward.remotePort ||
          existing.target.localPort !== forward.localPort
        ) {
          portForwardTabs = portForwardTabs.map((tab) =>
            tab.id === tabId
              ? {
                  ...tab,
                  target: {
                    name: serviceName,
                    namespace: forward.namespace,
                    remotePort: forward.remotePort,
                    localPort: forward.localPort,
                  },
                  uniqueKey: key,
                  url,
                  loading: false,
                  statusMessage: nextMessage,
                }
              : tab,
          );
        }
      }

      const workbenchTab: WorkbenchTab = {
        id: tabId,
        kind: "port-forward",
        title: `Web ${serviceName}`,
        subtitle: `${forward.namespace}:${forward.localPort}`,
      };
      const existingWorkbenchTab = workbenchTabs.find((tab) => tab.id === tabId);
      if (existingWorkbenchTab) {
        if (
          existingWorkbenchTab.title !== workbenchTab.title ||
          existingWorkbenchTab.subtitle !== workbenchTab.subtitle ||
          existingWorkbenchTab.kind !== workbenchTab.kind
        ) {
          workbenchTabs = workbenchTabs.map((tab) => (tab.id === tabId ? workbenchTab : tab));
        }
      } else {
        workbenchTabs = [...workbenchTabs, workbenchTab];
      }
    }

    if (!activeWorkbenchTabId && resolvedServiceForwards.length > 0) {
      const first = resolvedServiceForwards[0];
      activeWorkbenchTabId = `port-forward:${first.forward.namespace}/${first.serviceName}`;
    }
  });

  function updateYamlTab(tabId: string, updater: (tab: YamlTabState) => YamlTabState) {
    yamlTabs = yamlTabs.map((tab) => (tab.id === tabId ? updater(tab) : tab));
  }

  function upsertWorkbenchTab(tab: WorkbenchTab) {
    const existing = workbenchTabs.find((item) => item.id === tab.id);
    if (existing) {
      workbenchTabs = workbenchTabs.map((item) => (item.id === tab.id ? tab : item));
    } else {
      workbenchTabs = [...workbenchTabs, tab];
    }
    activeWorkbenchTabId = tab.id;
  }

  function rememberClosedTab(tabId: string) {
    const yamlTab = getYamlTab(tabId);
    if (!yamlTab) return;
    const entry: ClosedWorkbenchTab = {
      target: { ...yamlTab.target },
      pinned: pinnedTabIds.has(tabId),
    };
    const deduped = closedWorkbenchTabs.filter((item) => {
      return !(
        item.target.name === entry.target.name && item.target.namespace === entry.target.namespace
      );
    });
    closedWorkbenchTabs = [entry, ...deduped].slice(0, 30);
  }

  function setActiveWorkbenchTab(tabId: string) {
    activeWorkbenchTabId = tabId;
    workbenchCollapsed = false;
  }

  async function closeWorkbenchTab(tabId: string, options: { skipConfirm?: boolean } = {}) {
    const previousTabs = workbenchTabs;
    const index = previousTabs.findIndex((tab) => tab.id === tabId);
    if (index === -1) return;
    const closingTab = previousTabs[index];
    if (
      !options.skipConfirm &&
      (closingTab.kind === "yaml" || closingTab.kind === "port-forward")
    ) {
      const confirmed = await confirmWorkbenchTabClose(closingTab);
      if (!confirmed) return;
    }
    rememberClosedTab(tabId);
    workbenchTabs = previousTabs.filter((tab) => tab.id !== tabId);
    pinnedTabIds = new Set([...pinnedTabIds].filter((id) => id !== tabId));
    yamlTabs = yamlTabs.filter((tab) => tab.id !== tabId);
    const closingPortForward = getPortForwardTab(tabId);
    portForwardTabs = portForwardTabs.filter((tab) => tab.id !== tabId);
    if (closingPortForward) {
      await stopPortForward(closingPortForward.uniqueKey);
    }
    const nextPaneTabIds = paneTabIds.map((id) => (id === tabId ? null : id)) as [
      string | null,
      string | null,
      string | null,
    ];
    setPaneTabIdsIfChanged(nextPaneTabIds);
    setCollapsedPaneIndexesIfChanged(
      collapsedPaneIndexes.filter((idx) => nextPaneTabIds[idx] !== null),
    );
    if (yamlCompareSourceTabId === tabId) yamlCompareSourceTabId = null;
    if (yamlComparePair && (yamlComparePair[0] === tabId || yamlComparePair[1] === tabId)) {
      yamlComparePair = null;
      yamlCompareTargetTabId = null;
    }
    if (activeWorkbenchTabId === tabId) {
      const fallback = previousTabs[index + 1] ?? previousTabs[index - 1] ?? null;
      activeWorkbenchTabId = fallback?.id ?? null;
    }
    if (workbenchTabs.length === 0) {
      workbenchCollapsed = false;
      workbenchFullscreen = false;
      setPaneTabIdsIfChanged([null, null, null]);
      setCollapsedPaneIndexesIfChanged([]);
      yamlCompareSourceTabId = null;
      yamlComparePair = null;
      yamlCompareTargetTabId = null;
    }
  }

  function reopenLastClosedTab() {
    const entry = closedWorkbenchTabs[0];
    if (!entry) return;
    closedWorkbenchTabs = closedWorkbenchTabs.slice(1);
    void openYamlTarget(entry.target, { scrollIntoView: false }).then(() => {
      if (entry.pinned) {
        const tabId = toYamlTabId(entry.target);
        pinnedTabIds = new Set([...pinnedTabIds, tabId]);
      }
    });
  }

  function assignTabToPane(paneIndex: 0 | 1 | 2, tabId: string | null) {
    const next: [string | null, string | null, string | null] = [...paneTabIds];
    next[paneIndex] = tabId;
    if (workbenchLayout === "dual") next[2] = null;
    setPaneTabIdsIfChanged(next);
    if (tabId) activeWorkbenchTabId = tabId;
    if (!tabId) {
      setCollapsedPaneIndexesIfChanged(collapsedPaneIndexes.filter((idx) => idx !== paneIndex));
    }
  }

  function setPaneTabIdsIfChanged(next: [string | null, string | null, string | null]) {
    if (paneTabIds[0] === next[0] && paneTabIds[1] === next[1] && paneTabIds[2] === next[2]) {
      return;
    }
    paneTabIds = next;
  }

  function getPaneCount() {
    if (workbenchLayout === "single") return 1;
    if (workbenchLayout === "dual") return 2;
    return 3;
  }

  function setCollapsedPaneIndexesIfChanged(next: number[]) {
    if (next.length === collapsedPaneIndexes.length) {
      let same = true;
      for (let idx = 0; idx < next.length; idx += 1) {
        if (next[idx] !== collapsedPaneIndexes[idx]) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
    collapsedPaneIndexes = next;
  }

  function getWorkbenchTab(tabId: string | null) {
    if (!tabId) return null;
    return orderedWorkbenchTabs.find((tab) => tab.id === tabId) ?? null;
  }

  function getPaneTab(index: number) {
    return getWorkbenchTab(paneTabIds[index]);
  }

  function getPaneIndexes() {
    return Array.from({ length: getPaneCount() }, (_, idx) => idx as 0 | 1 | 2);
  }

  function isPaneCollapsed(paneIndex: number) {
    return collapsedPaneIndexes.includes(paneIndex);
  }

  function canCollapsePane(paneIndex: number) {
    if (getPaneCount() <= 1) return false;
    const tabId = paneTabIds[paneIndex];
    if (!tabId || !getWorkbenchTab(tabId)) return false;
    return true;
  }

  function togglePaneCollapsed(paneIndex: number) {
    if (!canCollapsePane(paneIndex)) return;
    if (collapsedPaneIndexes.includes(paneIndex)) {
      setCollapsedPaneIndexesIfChanged(collapsedPaneIndexes.filter((idx) => idx !== paneIndex));
      return;
    }
    const paneCount = getPaneCount();
    const expandedCount = paneCount - collapsedPaneIndexes.length;
    if (expandedCount <= 1) return;
    setCollapsedPaneIndexesIfChanged([...collapsedPaneIndexes, paneIndex]);
  }

  function getPaneWrapperClass(index: number) {
    if (isPaneCollapsed(index)) return "w-11 flex-none";
    return "min-w-0 flex-1";
  }

  function isTabPinned(tabId: string) {
    return pinnedTabIds.has(tabId);
  }

  function togglePinTab(tabId: string) {
    const next = new Set(pinnedTabIds);
    if (next.has(tabId)) next.delete(tabId);
    else next.add(tabId);
    pinnedTabIds = next;
  }

  function canCompareWithSelected(tabId: string) {
    return tabId.startsWith("yaml:");
  }

  function isYamlCompareTarget(tabId: string) {
    return yamlCompareTargetTabId === tabId;
  }

  function selectYamlForCompare(tabId: string) {
    if (!canCompareWithSelected(tabId)) return;
    if (yamlCompareSourceTabId === tabId) {
      yamlCompareSourceTabId = null;
      if (yamlComparePair && (yamlComparePair[0] === tabId || yamlComparePair[1] === tabId)) {
        yamlComparePair = null;
        yamlCompareTargetTabId = null;
      }
      return;
    }
    yamlCompareSourceTabId = tabId;
  }

  function compareYamlWithSelected(targetTabId: string) {
    if (!canCompareWithSelected(targetTabId)) return;
    if (!yamlCompareSourceTabId) {
      yamlCompareSourceTabId = targetTabId;
      yamlComparePair = null;
      yamlCompareTargetTabId = null;
      return;
    }
    if (yamlCompareSourceTabId === targetTabId) {
      yamlCompareSourceTabId = null;
      yamlComparePair = null;
      yamlCompareTargetTabId = null;
      return;
    }
    if (
      yamlComparePair &&
      ((yamlComparePair[0] === yamlCompareSourceTabId && yamlComparePair[1] === targetTabId) ||
        (yamlComparePair[1] === yamlCompareSourceTabId && yamlComparePair[0] === targetTabId))
    ) {
      yamlComparePair = null;
      yamlCompareTargetTabId = null;
      return;
    }
    yamlComparePair = [yamlCompareSourceTabId, targetTabId];
    yamlCompareTargetTabId = targetTabId;
    setWorkbenchLayout("dual");
    assignTabToPane(0, yamlCompareSourceTabId);
    assignTabToPane(1, targetTabId);
    assignTabToPane(2, null);
    setActiveWorkbenchTab(targetTabId);
  }

  function getYamlCompareDiffLines(tabId: string) {
    if (!yamlComparePair) return [];
    const [leftId, rightId] = yamlComparePair;
    const partnerId = leftId === tabId ? rightId : rightId === tabId ? leftId : null;
    if (!partnerId) return [];
    const tab = getYamlTab(tabId);
    const partner = getYamlTab(partnerId);
    if (!tab || !partner) return [];
    const leftLines = tab.yamlText.replace(/\r\n/g, "\n").split("\n");
    const rightLines = partner.yamlText.replace(/\r\n/g, "\n").split("\n");
    const maxLines = Math.max(leftLines.length, rightLines.length);
    const diffLines: number[] = [];
    for (let idx = 0; idx < maxLines; idx += 1) {
      if ((leftLines[idx] ?? "") !== (rightLines[idx] ?? "")) {
        diffLines.push(idx + 1);
      }
    }
    return diffLines;
  }

  const workbenchStorageKey = $derived(`${WORKBENCH_SETTINGS_PREFIX}:${scopeKey}`);

  function loadWorkbenchUiSettings() {
    if (typeof window === "undefined") return;
    try {
      const parsed = readJsonFromStorage(workbenchStorageKey, {
        fallback: {} as Partial<{
          layout: WorkbenchLayout;
          collapsed: boolean;
          fullscreen: boolean;
          tabs: PersistedYamlWorkbenchTab[];
          closedTabs: PersistedYamlWorkbenchTab[];
          paneTabIds: [string | null, string | null, string | null];
          collapsedPaneIndexes: number[];
          pinnedTabIds: string[];
          activeTabId: string | null;
          yamlCompareSourceTabId: string | null;
          yamlComparePair: [string, string] | null;
          yamlCompareTargetTabId: string | null;
        }>,
      });
      if (Object.keys(parsed).length === 0) return;
      const typed = parsed as Partial<{
        layout: WorkbenchLayout;
        collapsed: boolean;
        fullscreen: boolean;
        tabs: PersistedYamlWorkbenchTab[];
        closedTabs: PersistedYamlWorkbenchTab[];
        paneTabIds: [string | null, string | null, string | null];
        collapsedPaneIndexes: number[];
        pinnedTabIds: string[];
        activeTabId: string | null;
        yamlCompareSourceTabId: string | null;
        yamlComparePair: [string, string] | null;
        yamlCompareTargetTabId: string | null;
      }>;
      workbenchLayout =
        typed.layout === "dual" || typed.layout === "triple" ? typed.layout : "single";
      const normalizedVisibility = normalizeWorkbenchVisibilityForDataMode($dashboardDataProfile, {
        workbenchCollapsed: Boolean(typed.collapsed),
        collapsedPaneIndexes: Array.isArray(typed.collapsedPaneIndexes)
          ? typed.collapsedPaneIndexes
              .filter((idx) => typeof idx === "number")
              .map((idx) => Math.max(0, Math.floor(idx)))
          : [],
      });
      workbenchCollapsed = normalizedVisibility.workbenchCollapsed;
      workbenchFullscreen = Boolean(typed.fullscreen);
      if (Array.isArray(typed.paneTabIds) && typed.paneTabIds.length === 3) {
        setPaneTabIdsIfChanged([
          typed.paneTabIds[0] ?? null,
          typed.paneTabIds[1] ?? null,
          typed.paneTabIds[2] ?? null,
        ]);
      }
      if (Array.isArray(typed.collapsedPaneIndexes)) {
        setCollapsedPaneIndexesIfChanged(normalizedVisibility.collapsedPaneIndexes);
      }
      if (Array.isArray(typed.pinnedTabIds)) {
        pinnedTabIds = new Set(typed.pinnedTabIds.filter((id) => typeof id === "string"));
      }
      if (typeof typed.activeTabId === "string" || typed.activeTabId === null) {
        activeWorkbenchTabId = typed.activeTabId ?? null;
      }
      if (Array.isArray(typed.tabs)) {
        pendingRestoredTabs = typed.tabs.filter(
          (tab) => typeof tab?.name === "string" && typeof tab?.namespace === "string",
        ) as PersistedYamlWorkbenchTab[];
      }
      if (Array.isArray(typed.closedTabs)) {
        closedWorkbenchTabs = typed.closedTabs
          .filter((tab) => typeof tab?.name === "string" && typeof tab?.namespace === "string")
          .map((tab) => ({
            target: { name: tab.name, namespace: tab.namespace },
            pinned: Boolean(tab.pinned),
          }))
          .slice(0, 30);
      }
      if (
        typeof typed.yamlCompareSourceTabId === "string" ||
        typed.yamlCompareSourceTabId === null
      ) {
        yamlCompareSourceTabId = typed.yamlCompareSourceTabId ?? null;
      }
      if (Array.isArray(typed.yamlComparePair) && typed.yamlComparePair.length === 2) {
        yamlComparePair = [typed.yamlComparePair[0], typed.yamlComparePair[1]];
      }
      if (
        typeof typed.yamlCompareTargetTabId === "string" ||
        typed.yamlCompareTargetTabId === null
      ) {
        yamlCompareTargetTabId = typed.yamlCompareTargetTabId ?? null;
      }
    } catch {
      workbenchLayout = "single";
      workbenchCollapsed = false;
      workbenchFullscreen = false;
      setPaneTabIdsIfChanged([null, null, null]);
      setCollapsedPaneIndexesIfChanged([]);
      pinnedTabIds = new Set<string>();
      closedWorkbenchTabs = [];
      pendingRestoredTabs = null;
      yamlCompareSourceTabId = null;
      yamlComparePair = null;
      yamlCompareTargetTabId = null;
      activeWorkbenchTabId = null;
    }
  }

  function persistWorkbenchUiSettings() {
    if (typeof window === "undefined") return;
    writeJsonToStorage(workbenchStorageKey, {
      layout: workbenchLayout,
      collapsed: workbenchCollapsed,
      fullscreen: workbenchFullscreen,
      tabs: yamlTabs.map((tab) => ({
        name: tab.target.name,
        namespace: tab.target.namespace,
        pinned: pinnedTabIds.has(tab.id),
      })),
      closedTabs: closedWorkbenchTabs.map((tab) => ({
        name: tab.target.name,
        namespace: tab.target.namespace,
        pinned: tab.pinned,
      })),
      paneTabIds,
      collapsedPaneIndexes,
      pinnedTabIds: [...pinnedTabIds],
      activeTabId: activeWorkbenchTabId,
      yamlCompareSourceTabId,
      yamlComparePair,
      yamlCompareTargetTabId,
    });
  }

  function toggleSort(column: SortBy) {
    if (sortBy !== column) {
      sortBy = column;
      sortDirection = "asc";
      return;
    }
    sortDirection = sortDirection === "asc" ? "desc" : "asc";
  }

  function formatCreatedWithAge(value: string): string {
    if (!value) return "-";
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return "-";
    return `${getTimeDifference(new Date(parsed))} ago (${new Date(parsed).toLocaleString()})`;
  }

  function getLabelEntries(row: ConfigurationRow): Array<[string, string]> {
    const metadata = asRecord(row.raw.metadata);
    return Object.entries(asRecord(metadata.labels)).map(([key, value]) => [
      key,
      String(value ?? ""),
    ]);
  }

  function getAnnotationEntries(row: ConfigurationRow): Array<[string, string]> {
    const metadata = asRecord(row.raw.metadata);
    return Object.entries(asRecord(metadata.annotations)).map(([key, value]) => [
      key,
      String(value ?? ""),
    ]);
  }

  function getDataEntries(row: ConfigurationRow): Array<[string, unknown]> {
    if (workloadKey === "configmaps" || workloadKey === "secrets") {
      return Object.entries(asRecord(row.raw.data));
    }
    return [];
  }

  function getDataEntrySize(value: unknown): string {
    const size = String(value ?? "").length;
    if (size < 1024) return `${size} B`;
    return `${(size / 1024).toFixed(1)} KB`;
  }

  function decodeBase64(value: unknown): string {
    const raw = String(value ?? "");
    if (!raw) return "";
    try {
      return atob(raw);
    } catch {
      return `[decode error] ${raw}`;
    }
  }

  function getSecretKeyState(key: string): SecretKeyState {
    return secretKeyStates.get(key) ?? secretGlobalState;
  }

  function cycleSecretKeyState(key: string) {
    const current = getSecretKeyState(key);
    const next: SecretKeyState =
      current === "masked" ? "base64" : current === "base64" ? "decoded" : "masked";
    const map = new Map(secretKeyStates);
    map.set(key, next);
    secretKeyStates = map;
  }

  function cycleSecretGlobalState() {
    const next: SecretKeyState =
      secretGlobalState === "masked"
        ? "base64"
        : secretGlobalState === "base64"
          ? "decoded"
          : "masked";
    secretGlobalState = next;
    secretKeyStates = new Map();
  }

  type ManagedFieldEntry = {
    manager: string;
    operation: string;
    time: string;
  };

  function getManagedFields(row: ConfigurationRow): ManagedFieldEntry[] {
    const metadata = asRecord(row.raw.metadata);
    const raw = asArray(metadata.managedFields);
    return raw
      .map((entry) => {
        const item = asRecord(entry);
        return {
          manager: typeof item.manager === "string" ? item.manager : "unknown",
          operation: typeof item.operation === "string" ? item.operation : "-",
          time: typeof item.time === "string" ? item.time : "",
        };
      })
      .filter((entry) => entry.manager.length > 0);
  }

  function getManagedManagerCount(row: ConfigurationRow): number {
    return new Set(getManagedFields(row).map((entry) => entry.manager)).size;
  }

  function getRbacRelationLines(row: ConfigurationRow): string[] {
    const raw = asRecord(row.raw);
    if (workloadKey === "roles" || workloadKey === "clusterroles") {
      const rules = asArray(raw.rules);
      return rules.map((rule, index) => {
        const item = asRecord(rule);
        const verbs = asArray(item.verbs)
          .map((entry) => String(entry))
          .join(",");
        const resources = asArray(item.resources)
          .map((entry) => String(entry))
          .join(",");
        return `Rule ${index + 1}: ${verbs || "-"} -> ${resources || "-"}`;
      });
    }
    if (workloadKey === "rolebindings" || workloadKey === "clusterrolebindings") {
      const roleRef = asRecord(raw.roleRef);
      const subjects = asArray(raw.subjects);
      const lines = [`RoleRef: ${String(roleRef.kind ?? "-")}/${String(roleRef.name ?? "-")}`];
      for (const subject of subjects) {
        const entry = asRecord(subject);
        lines.push(
          `Subject: ${String(entry.kind ?? "-")} ${String(entry.namespace ?? row.namespace)}/${String(entry.name ?? "-")}`,
        );
      }
      return lines;
    }
    if (workloadKey === "serviceaccounts") {
      const secrets = asArray(raw.secrets).map((item) => String(asRecord(item).name ?? "-"));
      const pullSecrets = asArray(raw.imagePullSecrets).map((item) =>
        String(asRecord(item).name ?? "-"),
      );
      return [
        `Secrets: ${secrets.length > 0 ? secrets.join(", ") : "none"}`,
        `Image pull secrets: ${pullSecrets.length > 0 ? pullSecrets.join(", ") : "none"}`,
      ];
    }
    return [];
  }

  function isRbacWorkload() {
    return (
      workloadKey === "serviceaccounts" ||
      workloadKey === "roles" ||
      workloadKey === "rolebindings" ||
      workloadKey === "clusterroles" ||
      workloadKey === "clusterrolebindings"
    );
  }

  function getRbacRiskFindings(row: ConfigurationRow) {
    return evaluateRbacRisk(workloadKey, row.raw).findings;
  }

  function getRbacRiskSeverity(score: number): "Low" | "Medium" | "High" | "Critical" {
    if (score >= 600) return "Critical";
    if (score >= 350) return "High";
    if (score >= 180) return "Medium";
    return "Low";
  }

  function getCrdVersionSummary(row: ConfigurationRow): string {
    const versions = asArray(asRecord(asRecord(row.raw).spec).versions);
    if (versions.length === 0) return "-";
    return versions
      .map((version) => {
        const item = asRecord(version);
        const served = item.served === true ? "served" : "hidden";
        const storage = item.storage === true ? "storage" : "";
        const deprecated = item.deprecated === true ? "deprecated" : "";
        return [String(item.name ?? "-"), served, storage, deprecated].filter(Boolean).join(" · ");
      })
      .join(" | ");
  }

  function getCrdConversionSummary(row: ConfigurationRow): string {
    const conversion = asRecord(asRecord(asRecord(row.raw).spec).conversion);
    const strategy = String(conversion.strategy ?? "None");
    const service = asRecord(asRecord(conversion.webhookClientConfig).service);
    if (strategy !== "Webhook") return strategy;
    return `${strategy}: ${String(service.namespace ?? "cluster")}/${String(service.name ?? "-")}`;
  }

  function getCrdConditionSummary(row: ConfigurationRow): string {
    const conditions = asArray(asRecord(asRecord(row.raw).status).conditions);
    const important = conditions.filter((condition) => {
      const item = asRecord(condition);
      const type = String(item.type ?? "");
      return type === "Established" || type === "Terminating" || type === "NonStructuralSchema";
    });
    if (important.length === 0) return "-";
    return important
      .map((condition) => {
        const item = asRecord(condition);
        return `${String(item.type ?? "-")}: ${String(item.status ?? "-")}`;
      })
      .join(" | ");
  }

  function getStorageDebugHints(row: ConfigurationRow): string[] {
    if (workloadKey !== "persistentvolumeclaims" && workloadKey !== "persistentvolumes") return [];
    const status = asRecord(row.raw.status);
    const conditions = asArray(status.conditions).map((entry) => asRecord(entry));
    const messages = conditions
      .map((condition) => String(condition.message ?? "").trim())
      .filter((message) => message.length > 0);
    const hints: string[] = [];
    if (row.phase.toLowerCase() === "pending") {
      hints.push("Pending volume. Check StorageClass, provisioner, and controller logs.");
    }
    if (workloadKey === "persistentvolumes" && row.claim === "-") {
      hints.push("Potential orphan PV. Verify claimRef and reclaim policy.");
    }
    return [...hints, ...messages];
  }

  function getNetworkDebugBundle(row: ConfigurationRow): string {
    if (
      workloadKey !== "services" &&
      workloadKey !== "endpoints" &&
      workloadKey !== "endpointslices" &&
      workloadKey !== "ingresses" &&
      workloadKey !== "networkpolicies"
    ) {
      return "";
    }
    const nsArg = isNamespaceScoped && row.namespace !== "cluster" ? `-n ${row.namespace}` : "";
    const base = resourceByWorkload[workloadKey] ?? workloadKey;
    const lines = [
      `kubectl get ${base} ${row.name} ${nsArg} -o yaml`.trim(),
      `kubectl describe ${base} ${row.name} ${nsArg}`.trim(),
    ];
    if (
      workloadKey === "services" ||
      workloadKey === "endpoints" ||
      workloadKey === "endpointslices" ||
      workloadKey === "ingresses"
    ) {
      lines.push(`kubectl get endpoints ${row.name} ${nsArg} -o wide`.trim());
    }
    if (workloadKey === "networkpolicies") {
      lines.push(`kubectl get pods ${nsArg} --show-labels`.trim());
    }
    return lines.join("\n");
  }

  function getRelationGraphLines(row: ConfigurationRow): string[] {
    const metadata = asRecord(row.raw.metadata);
    const ownerReferences = asArray(metadata.ownerReferences).map((entry) => asRecord(entry));
    const graph = buildResourceRelationGraph({
      root: {
        kind: getDetailsResourceLabel(),
        name: row.name,
        namespace: row.namespace,
      },
      ownerReferences: ownerReferences.map((entry) => ({
        kind: typeof entry.kind === "string" ? entry.kind : undefined,
        name: typeof entry.name === "string" ? entry.name : undefined,
      })),
      podRefs:
        workloadKey === "endpoints"
          ? asArray(row.raw.subsets).flatMap((subset) =>
              asArray(asRecord(subset).addresses).map((address) => {
                const targetRef = asRecord(asRecord(address).targetRef);
                return {
                  name: typeof targetRef.name === "string" ? targetRef.name : undefined,
                  namespace:
                    typeof targetRef.namespace === "string" ? targetRef.namespace : row.namespace,
                };
              }),
            )
          : workloadKey === "endpointslices"
            ? asArray(row.raw.endpoints).map((endpoint) => {
                const targetRef = asRecord(asRecord(endpoint).targetRef);
                return {
                  name: typeof targetRef.name === "string" ? targetRef.name : undefined,
                  namespace:
                    typeof targetRef.namespace === "string" ? targetRef.namespace : row.namespace,
                };
              })
            : [],
    });
    return graph.related.map(
      (entry) => `${entry.kind}: ${entry.namespace ?? "cluster"}/${entry.name}`,
    );
  }

  async function loadDetailsEvents(row: ConfigurationRow) {
    if (!clusterId) return;
    await detailsActions.runLatest("details-events", async ({ signal, isLatest }) => {
      detailsEventsLoading = true;
      detailsEventsError = null;
      detailsEvents = [];
      try {
        const kind = getDetailsResourceLabel();
        const nameSelector = `involvedObject.name=${row.name}`;
        const kindSelector = `involvedObject.kind=${kind}`;
        const fieldSelector = `${nameSelector},${kindSelector}`;
        const command =
          isNamespaceScoped && row.namespace !== "cluster"
            ? `get events -n ${row.namespace} --field-selector ${fieldSelector}`
            : `get events --all-namespaces --field-selector ${fieldSelector}`;
        const response = await kubectlJson<{ items?: GenericItem[] }>(command, {
          clusterId,
          signal,
        });
        if (!isLatest()) return;
        const payload = response && typeof response === "object" ? response : {};
        const items = Array.isArray((payload as { items?: GenericItem[] }).items)
          ? ((payload as { items: GenericItem[] }).items ?? [])
          : [];
        detailsEvents = items.map((item) => {
          const source = asRecord(item.source);
          return {
            type: typeof item.type === "string" ? item.type : "Normal",
            reason: typeof item.reason === "string" ? item.reason : "-",
            message: typeof item.message === "string" ? item.message : "-",
            lastTimestamp: String(
              item.lastTimestamp ?? item.eventTime ?? item.firstTimestamp ?? "",
            ),
            source: String(source.component ?? source.host ?? ""),
            count: Number(item.count ?? 1),
          };
        });
      } catch (error) {
        if (!isLatest()) return;
        detailsEventsError = toWorkloadError(error).message || "Failed to load events.";
      } finally {
        if (isLatest()) {
          detailsEventsLoading = false;
        }
      }
    });
  }

  function getFilteredDataEntries(row: ConfigurationRow): Array<[string, unknown]> {
    const q = dataDetailsSearch.trim().toLowerCase();
    const entries = getDataEntries(row);
    if (!q) return entries;
    return entries.filter(([key]) => key.toLowerCase().includes(q));
  }

  function toggleRow(uid: string, checked: boolean) {
    const next = new Set(selectedRowIds);
    if (checked) next.add(uid);
    else next.delete(uid);
    selectedRowIds = next;
  }

  function toggleAllRows(checked: boolean) {
    if (!checked) {
      selectedRowIds = new Set();
      return;
    }
    selectedRowIds = new Set(filteredRows.map((row) => row.uid));
  }

  function getGroupSelectionState(rows: ConfigurationRow[]) {
    const selectedCount = rows.filter((row) => selectedRowIds.has(row.uid)).length;
    return {
      checked: rows.length > 0 && selectedCount === rows.length,
      indeterminate: selectedCount > 0 && selectedCount < rows.length,
    };
  }

  function toggleGroupSelection(next: boolean, rows: ConfigurationRow[]) {
    const updated = new Set(selectedRowIds);
    for (const row of rows) {
      if (next) updated.add(row.uid);
      else updated.delete(row.uid);
    }
    selectedRowIds = updated;
  }

  function showDetails(row: ConfigurationRow) {
    selectedDetail = row;
    detailsOpen = true;
    showManagedFieldsDetails = false;
    dataDetailsSearch = "";
    secretKeyStates = new Map();
    secretGlobalState = "masked";
    detailsEvents = [];
    detailsEventsError = null;
    detailsEventsLoading = true;
    void loadDetailsEvents(row);
    trackWorkloadEvent("details_open", {
      workload: workloadKey,
      resource: row.name,
      namespace: row.namespace,
    });
  }

  function firstSelected(): ConfigurationRow | null {
    return selectedRows[0] ?? null;
  }

  function buildGetArgsForTarget(
    target: { name: string; namespace: string },
    output: "json" | "yaml",
  ): string[] {
    const resource = resourceByWorkload[workloadKey] ?? workloadKey;
    const args = ["get", resource, target.name];
    if (isNamespaceScoped && target.namespace !== "cluster") {
      args.push("-n", target.namespace);
    }
    args.push("-o", output);
    return args;
  }

  async function buildGetArgs(row: ConfigurationRow, output: "json" | "yaml"): Promise<string[]> {
    return buildGetArgsForTarget({ name: row.name, namespace: row.namespace }, output);
  }

  function normalizeWatcherRefreshSeconds(value: number) {
    if (!Number.isFinite(value)) return DEFAULT_WATCHER_SETTINGS.refreshSeconds;
    return Math.min(600, Math.max(5, Math.round(value)));
  }

  async function refreshNow(source: "manual" | "watcher" = "manual") {
    if (!clusterId || !workloadKey) return;
    if (
      source === "watcher" &&
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      return;
    }
    if (source === "manual" && actionInFlight) return;
    if (source === "watcher" && watcherInFlight) return;
    const command = KUBECTL_COMMANDS[workloadKey];
    if (!command) return;
    if (source === "manual") {
      actionInFlight = true;
    } else {
      watcherInFlight = true;
    }
    markConfigurationSyncLoading(clusterId, workloadKey);
    if (source === "manual") {
      errorMessage = null;
    } else {
      watcherError = null;
    }
    try {
      const selected = getSelectedNamespaceList($selectedNamespace);
      const namespaceArg =
        isNamespaceScoped && selected && selected.length === 1
          ? `-n ${selected[0]}`
          : "--all-namespaces";
      const resolved = command.includes("${ns}") ? command.replace("${ns}", namespaceArg) : command;
      const response = await kubectlJson<{ items?: GenericItem[] }>(resolved, { clusterId });
      const payload =
        response && typeof response === "object" ? (response as { items?: GenericItem[] }) : {};
      const items = Array.isArray(payload.items) ? payload.items : [];
      rowsSnapshot = items.map((item: GenericItem, index: number) => toRow(item, index));
      if (source === "manual") {
        actionNotification = notifySuccess(`${tableTitle} refreshed`);
      }
      lastWatcherSuccessAt = Date.now();
      watcherError = null;
      markConfigurationSyncSuccess(clusterId, workloadKey);
    } catch (error) {
      const normalized = toWorkloadError(error);
      const message = normalized.message || `Failed to refresh ${tableTitle}`;
      if (source === "manual") {
        errorMessage = message;
      } else {
        watcherError = message;
      }
      markConfigurationSyncError(clusterId, workloadKey, message);
    } finally {
      if (source === "manual") {
        actionInFlight = false;
      } else {
        watcherInFlight = false;
      }
    }
  }

  function startWatcher() {
    if (!watcherEnabled || !clusterId) return;
    watcherEngine.start(true);
  }

  function stopWatcher() {
    watcherEngine.stop();
  }

  function bindConfigurationSyncStore(nextClusterId: string, nextWorkloadKey: WorkloadType) {
    configurationSyncStoreUnsubscribe?.();
    configurationSyncStoreUnsubscribe = selectClusterConfigurationItems(
      nextClusterId,
      nextWorkloadKey,
    ).subscribe((items) => {
      applyItemsSnapshot(items as GenericItem[]);
    });
  }

  const watcherStorageKey = $derived(`${WATCHER_SETTINGS_PREFIX}:${clusterId}:${workloadKey}`);
  const tableStateStorageKey = $derived(`${TABLE_STATE_PREFIX}:${clusterId}:${workloadKey}`);

  function loadWatcherSettings() {
    if (typeof window === "undefined") return;
    try {
      const parsed = readJsonFromStorage(watcherStorageKey, {
        fallback: {} as Partial<WatcherSettings>,
      }) as Partial<WatcherSettings>;
      if (Object.keys(parsed).length === 0) return;
      watcherEnabled = parsed.enabled ?? DEFAULT_WATCHER_SETTINGS.enabled;
      watcherRefreshSeconds = normalizeWatcherRefreshSeconds(
        parsed.refreshSeconds ?? DEFAULT_WATCHER_SETTINGS.refreshSeconds,
      );
      viewMode = parsed.viewMode === "namespace" ? "namespace" : DEFAULT_WATCHER_SETTINGS.viewMode;
    } catch {
      watcherEnabled = DEFAULT_WATCHER_SETTINGS.enabled;
      watcherRefreshSeconds = DEFAULT_WATCHER_SETTINGS.refreshSeconds;
      viewMode = DEFAULT_WATCHER_SETTINGS.viewMode;
    } finally {
      watcherSettingsLoaded = true;
    }
  }

  function persistWatcherSettings() {
    if (typeof window === "undefined") return;
    writeJsonToStorage(watcherStorageKey, {
      enabled: watcherEnabled,
      refreshSeconds: normalizeWatcherRefreshSeconds(watcherRefreshSeconds),
      viewMode,
    });
  }

  function loadTableState() {
    if (typeof window === "undefined") return;
    try {
      const parsed = readJsonFromStorage(tableStateStorageKey, {
        fallback: {} as Partial<{
          sortBy: SortBy;
          sortDirection: SortDirection;
          quickFilter: QuickFilterId;
        }>,
      }) as Partial<{
        sortBy: SortBy;
        sortDirection: SortDirection;
        quickFilter: QuickFilterId;
      }>;
      if (Object.keys(parsed).length === 0) return;
      if (typeof parsed.sortBy === "string") {
        sortBy = parsed.sortBy;
      }
      if (parsed.sortDirection === "asc" || parsed.sortDirection === "desc") {
        sortDirection = parsed.sortDirection;
      }
      if (typeof parsed.quickFilter === "string") {
        quickFilter = parsed.quickFilter;
      }
    } catch {
      // ignore malformed local state
    } finally {
      tableStateLoaded = true;
    }
  }

  function persistTableState() {
    if (typeof window === "undefined") return;
    writeJsonToStorage(tableStateStorageKey, {
      sortBy,
      sortDirection,
      quickFilter,
    });
  }

  function applyWatcherMode() {
    if (!clusterId || !workloadKey) return;
    const nextScopeKey = `${clusterId}:${workloadKey}`;
    setConfigurationSyncEnabled(clusterId, workloadKey, watcherPolicy.enabled);
    if (watcherPolicy.enabled) {
      if (watcherPolicy.mode === "stream") {
        stopWatcher();
        if (activeConfigurationSyncScopeKey !== nextScopeKey) {
          bindConfigurationSyncStore(clusterId, workloadKey);
          initConfigurationSync(
            clusterId,
            workloadKey,
            Array.isArray(data.items) ? data.items : [],
          );
          activeConfigurationSyncScopeKey = nextScopeKey;
          configurationSyncStarted = true;
        }
      } else {
        if (configurationSyncStarted && activeConfigurationSyncScopeKey === nextScopeKey) {
          destroyConfigurationSync(clusterId, workloadKey);
          configurationSyncStarted = false;
          activeConfigurationSyncScopeKey = null;
        }
        startWatcher();
      }
      return;
    }
    stopWatcher();
    if (configurationSyncStarted && activeConfigurationSyncScopeKey === nextScopeKey) {
      destroyConfigurationSync(clusterId, workloadKey);
      configurationSyncStarted = false;
      activeConfigurationSyncScopeKey = null;
    }
  }

  function toggleWatcher() {
    watcherEnabled = !watcherEnabled;
    persistWatcherSettings();
    applyWatcherMode();
  }

  function setWatcherRefresh(value: number) {
    watcherRefreshSeconds = normalizeWatcherRefreshSeconds(value);
    persistWatcherSettings();
    if (watcherPolicy.enabled) {
      applyWatcherMode();
    }
  }

  function setTableViewMode(mode: ConfigurationTableViewMode) {
    viewMode = mode;
    persistWatcherSettings();
  }

  async function loadYamlForTab(tabId: string) {
    if (!clusterId) return;
    const tab = getYamlTab(tabId);
    if (!tab) return;
    updateYamlTab(tabId, (current) => ({
      ...current,
      yamlLoading: true,
      yamlError: null,
    }));
    try {
      const args = buildGetArgsForTarget(tab.target, "yaml");
      const result = await kubectlRawArgsFront(args, { clusterId });
      if (result.errors || result.code !== 0) {
        throw new Error(result.errors || result.output || "Failed to load YAML");
      }
      const output = result.output || "";
      updateYamlTab(tabId, (current) => ({
        ...current,
        yamlLoading: false,
        yamlError: null,
        yamlOriginalText: output,
        yamlText: output,
        yamlDriftDetected: false,
        yamlDriftMessage: null,
        yamlDriftClusterYaml: "",
      }));
    } catch (error) {
      const normalized = toWorkloadError(error);
      updateYamlTab(tabId, (current) => ({
        ...current,
        yamlLoading: false,
        yamlError: normalized.message || "Failed to load YAML",
      }));
    }
  }

  function toYamlTabId(target: { name: string; namespace: string }) {
    return `yaml:${target.namespace}/${target.name}`;
  }

  async function openYamlTarget(
    target: { name: string; namespace: string },
    options: { scrollIntoView?: boolean } = {},
  ) {
    const nextTabId = toYamlTabId(target);
    const existing = getYamlTab(nextTabId);
    if (!existing) {
      yamlTabs = [
        ...yamlTabs,
        {
          id: nextTabId,
          target: { ...target },
          yamlOriginalText: "",
          yamlText: "",
          yamlError: null,
          yamlLoading: true,
          yamlSaving: false,
          yamlDriftDetected: false,
          yamlDriftMessage: null,
          yamlDriftClusterYaml: "",
        },
      ];
    }
    upsertWorkbenchTab({
      id: nextTabId,
      kind: "yaml",
      title: `YAML ${target.name}`,
      subtitle: target.namespace,
    });
    if (workbenchLayout !== "single") {
      const nextPaneIds: [string | null, string | null, string | null] = [...paneTabIds];
      const maxPane = workbenchLayout === "dual" ? 2 : 3;
      let assigned = false;
      for (let idx = 0; idx < maxPane; idx += 1) {
        if (nextPaneIds[idx] === nextTabId) {
          assigned = true;
          break;
        }
      }
      if (!assigned) {
        for (let idx = 0; idx < maxPane; idx += 1) {
          if (!nextPaneIds[idx]) {
            nextPaneIds[idx] = nextTabId;
            assigned = true;
            break;
          }
        }
      }
      if (!assigned) nextPaneIds[0] = nextTabId;
      if (workbenchLayout === "dual") nextPaneIds[2] = null;
      setPaneTabIdsIfChanged(nextPaneIds);
    }
    workbenchCollapsed = false;
    workbenchFullscreen = false;
    await tick();
    await loadYamlForTab(nextTabId);
  }

  async function openYamlEditor(row: ConfigurationRow) {
    trackWorkloadEvent("yaml_edit_open", {
      workload: workloadKey,
      resource: row.name,
      namespace: row.namespace,
    });
    await openYamlTarget({ name: row.name, namespace: row.namespace });
  }

  function getServiceEndpoint(row: ConfigurationRow): {
    remotePort: number;
    scheme: "http" | "https";
  } {
    const spec = asRecord(asRecord(row.raw).spec);
    const ports = asArray(spec.ports);
    if (ports.length === 0) return { remotePort: 80, scheme: "http" };
    const discovered = ports
      .map((entry) => asRecord(entry))
      .map((entry) => ({
        number: Number(entry.port ?? 0),
        name: String(entry.name ?? "").toLowerCase(),
        appProtocol: String(entry.appProtocol ?? "").toLowerCase(),
        protocol: String(entry.protocol ?? "TCP").toUpperCase(),
      }))
      .filter(
        (entry) => Number.isFinite(entry.number) && entry.number > 0 && entry.protocol === "TCP",
      );
    const nonMetrics = discovered.filter(
      (entry) => !entry.name.includes("metrics") && !entry.name.includes("prometheus"),
    );
    const candidates = nonMetrics.length > 0 ? nonMetrics : discovered;
    const best = candidates[0];
    if (!best) return { remotePort: 80, scheme: "http" };
    const scheme: "http" | "https" =
      best.name.includes("https") ||
      best.appProtocol.includes("https") ||
      best.number === 443 ||
      best.number === 8443
        ? "https"
        : "http";
    return { remotePort: best.number, scheme };
  }

  function getServicePortForwardTabId(row: ConfigurationRow) {
    return `port-forward:${row.namespace}/${row.name}`;
  }

  function getRandomLocalPort() {
    return Math.floor(Math.random() * (60999 - 30000 + 1)) + 30000;
  }

  function requestLocalPort(remotePort: number): number | null {
    if (typeof window === "undefined") return getRandomLocalPort();
    const suggested = getRandomLocalPort();
    const raw = window.prompt(
      `Remote port: ${remotePort}\nEnter local port (1-65535):`,
      String(suggested),
    );
    if (raw === null) return null;
    const parsed = Number(raw.trim());
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      errorMessage = "Invalid local port. Use integer 1-65535.";
      return null;
    }
    return parsed;
  }

  function isLocalPortInUse(localPort: number): boolean {
    return Object.values($activePortForwards).some((forward) => {
      if (!forward) return false;
      return (
        clusterIds.includes(forward.clusterId) &&
        forward.isRunning &&
        forward.localPort === localPort
      );
    });
  }

  async function openServicePortForward(row: ConfigurationRow) {
    if (!clusterId || workloadKey !== "services") return;
    if (!isTauriAvailable()) {
      errorMessage = "Port-forward preview is available only in the desktop runtime.";
      return;
    }
    const endpoint = getServiceEndpoint(row);
    const remotePort = endpoint.remotePort;
    const startMode = requestPortForwardStartMode(remotePort);
    if (!startMode) return;
    const selectedLocalPort = requestLocalPort(remotePort);
    if (!selectedLocalPort) return;
    const localPort = selectedLocalPort;
    if (isLocalPortInUse(localPort)) {
      errorMessage = `Local port ${localPort} is already in use by another running port-forward.`;
      return;
    }
    const target = `svc/${row.name}`;
    const uniqueKey = `${clusterId}:${row.namespace}:${target}:${localPort}:${remotePort}`;
    const url = `${endpoint.scheme}://127.0.0.1:${localPort}`;
    const tabId = getServicePortForwardTabId(row);

    const existing = getPortForwardTab(tabId);
    if (
      existing?.uniqueKey === uniqueKey &&
      isRunningForwardByKey($activePortForwards, uniqueKey)
    ) {
      const nextMessage = `Forwarding ${localPort}:${remotePort}`;
      portForwardTabs = portForwardTabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              loading: false,
              statusMessage: nextMessage,
              target: { name: row.name, namespace: row.namespace, remotePort, localPort },
              url,
            }
          : tab,
      );
      errorMessage = null;
      if (startMode === "start-and-open") {
        void popOutPortForwardPreview(url);
      }
      return;
    }
    if (existing && existing.uniqueKey !== uniqueKey) {
      await stopPortForward(existing.uniqueKey).catch(() => undefined);
    }
    if (existing) {
      portForwardTabs = portForwardTabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              target: { name: row.name, namespace: row.namespace, remotePort, localPort },
              uniqueKey,
              url,
              loading: true,
              statusMessage: "Starting port-forward...",
            }
          : tab,
      );
    } else {
      portForwardTabs = [
        ...portForwardTabs,
        {
          id: tabId,
          target: { name: row.name, namespace: row.namespace, remotePort, localPort },
          uniqueKey,
          url,
          loading: true,
          statusMessage: "Starting port-forward...",
        },
      ];
    }
    upsertWorkbenchTab({
      id: tabId,
      kind: "port-forward",
      title: `Web ${row.name}`,
      subtitle: `${row.namespace}:${localPort}`,
    });

    if (workbenchLayout !== "single") {
      const nextPaneIds: [string | null, string | null, string | null] = [...paneTabIds];
      const maxPane = workbenchLayout === "dual" ? 2 : 3;
      let assigned = false;
      for (let idx = 0; idx < maxPane; idx += 1) {
        if (nextPaneIds[idx] === tabId) {
          assigned = true;
          break;
        }
      }
      if (!assigned) {
        for (let idx = 0; idx < maxPane; idx += 1) {
          if (!nextPaneIds[idx]) {
            nextPaneIds[idx] = tabId;
            assigned = true;
            break;
          }
        }
      }
      if (!assigned) nextPaneIds[0] = tabId;
      if (workbenchLayout === "dual") nextPaneIds[2] = null;
      setPaneTabIdsIfChanged(nextPaneIds);
    }

    const started = await startPortForward({
      namespace: row.namespace,
      resource: target,
      remotePort,
      localPort,
      clusterId,
      uniqueKey,
    });

    if (!started.success) {
      errorMessage = started.error ?? "Failed to start port-forward.";
      portForwardTabs = portForwardTabs.map((tab) =>
        tab.id === tabId
          ? { ...tab, loading: false, statusMessage: started.error ?? "Failed." }
          : tab,
      );
      return;
    }

    portForwardTabs = portForwardTabs.map((tab) =>
      tab.id === tabId
        ? {
            ...tab,
            target: { name: row.name, namespace: row.namespace, remotePort, localPort },
            uniqueKey,
            url,
            loading: false,
            statusMessage: `Forwarding ${localPort}:${remotePort}`,
          }
        : tab,
    );
    workbenchCollapsed = false;
    workbenchFullscreen = false;
    if (startMode === "start-and-open") {
      void popOutPortForwardPreview(url);
    }
  }

  function refreshPortForwardTab(tabId: string) {
    portForwardTabs = portForwardTabs.map((tab) =>
      tab.id === tabId ? { ...tab, url: withRefreshNonce(tab.url) } : tab,
    );
  }

  async function openUrlInExternalBrowser(url: string) {
    await openExternalUrl(url);
  }

  async function openPortForwardTabInAppWindow(tabId: string) {
    const tab = getPortForwardTab(tabId);
    if (!tab) return;
    await popOutPortForwardPreview(tab.url);
  }

  async function stopPortForwardTab(tabId: string) {
    const tab = getPortForwardTab(tabId);
    if (!tab || tab.loading) return;
    const confirmed = await confirmAction("Stop this port-forward?", "Stop port-forward");
    if (!confirmed) return;
    updatePortForwardTab(tabId, (current) => ({
      ...current,
      loading: true,
      statusMessage: "Stopping port-forward...",
    }));
    try {
      await closeWorkbenchTab(tabId, { skipConfirm: true });
      actionNotification = notifySuccess("Port-forward stopped.");
      errorMessage = null;
    } catch (error) {
      updatePortForwardTab(tabId, (current) => ({
        ...current,
        loading: false,
        statusMessage: "Failed to stop port-forward.",
      }));
      errorMessage = error instanceof Error ? error.message : "Failed to stop port-forward.";
    }
  }

  function requestCloseWorkbenchTab(tabId: string) {
    void closeWorkbenchTab(tabId);
  }

  async function copyText(text: string) {
    if (typeof window === "undefined") return;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }

  async function copyPortForwardUrl(tabId: string) {
    const tab = getPortForwardTab(tabId);
    if (!tab) return;
    try {
      await copyText(tab.url);
      actionNotification = notifySuccess(`Copied URL: ${tab.url}`);
      errorMessage = null;
    } catch {
      errorMessage = "Failed to copy port-forward URL.";
    }
  }

  function stopAllPortForwardTabs() {
    for (const tab of portForwardTabs) {
      void stopPortForward(tab.uniqueKey);
    }
    portForwardTabs = [];
  }

  function rebaseYamlTabEdits(tabId: string) {
    const tab = getYamlTab(tabId);
    if (!tab?.yamlDriftClusterYaml) return;
    updateYamlTab(tabId, (current) => ({
      ...current,
      yamlOriginalText: current.yamlDriftClusterYaml,
      yamlDriftDetected: false,
      yamlDriftMessage: null,
      yamlDriftClusterYaml: "",
      yamlError: null,
    }));
  }

  async function saveYamlTab(tabId: string) {
    const tab = getYamlTab(tabId);
    if (!clusterId || !tab) return;
    if (!tab.yamlText.trim()) {
      updateYamlTab(tabId, (current) => ({ ...current, yamlError: "YAML is empty." }));
      return;
    }
    try {
      parseYaml(tab.yamlText);
    } catch (error) {
      if (error instanceof YAMLException) {
        const line = typeof error.mark?.line === "number" ? error.mark.line + 1 : null;
        updateYamlTab(tabId, (current) => ({
          ...current,
          yamlError: line ? `YAML syntax error at line ${line}: ${error.message}` : error.message,
        }));
      } else {
        updateYamlTab(tabId, (current) => ({
          ...current,
          yamlError: error instanceof Error ? error.message : "Invalid YAML syntax.",
        }));
      }
      return;
    }

    updateYamlTab(tabId, (current) => ({
      ...current,
      yamlSaving: true,
      yamlError: null,
    }));
    const relativePath = `tmp/configuration-edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.yaml`;
    try {
      const current = getYamlTab(tabId);
      if (!current) return;
      const latestArgs = buildGetArgsForTarget(current.target, "yaml");
      const latest = await kubectlRawArgsFront(latestArgs, { clusterId });
      if (latest.errors || latest.code !== 0) {
        updateYamlTab(tabId, (value) => ({
          ...value,
          yamlSaving: false,
          yamlError: latest.errors || "Failed to load current YAML from cluster.",
        }));
        return;
      }

      const fresh = getYamlTab(tabId);
      if (!fresh) return;
      const drift = checkYamlDrift(fresh.yamlOriginalText, latest.output || "");
      if (drift.hasDrift) {
        updateYamlTab(tabId, (value) => ({
          ...value,
          yamlSaving: false,
          yamlDriftDetected: true,
          yamlDriftMessage: buildDriftMessage(drift),
          yamlDriftClusterYaml: latest.output || "",
          yamlError: null,
        }));
        return;
      }

      await mkdir("tmp", { recursive: true, baseDir: BaseDirectory.AppData });
      await writeTextFile(relativePath, fresh.yamlText, { baseDir: BaseDirectory.AppData });
      const appDataPath = await path.appDataDir();
      const absolutePath = await path.join(appDataPath, relativePath);
      const dryRun = await kubectlRawArgsFront(["apply", "--dry-run=server", "-f", absolutePath], {
        clusterId,
      });
      if (dryRun.errors || dryRun.code !== 0) {
        updateYamlTab(tabId, (value) => ({
          ...value,
          yamlSaving: false,
          yamlError: formatApplyErrorMessage(
            dryRun.errors || "Server dry-run failed.",
            `${value.target.namespace}/${value.target.name}`,
          ),
        }));
        return;
      }
      const response = await kubectlRawArgsFront(["apply", "-f", absolutePath], { clusterId });
      if (response.errors || response.code !== 0) {
        updateYamlTab(tabId, (value) => ({
          ...value,
          yamlSaving: false,
          yamlError: formatApplyErrorMessage(
            response.errors || "Failed to apply YAML.",
            `${value.target.namespace}/${value.target.name}`,
          ),
        }));
        return;
      }
      updateYamlTab(tabId, (value) => ({
        ...value,
        yamlSaving: false,
        yamlOriginalText: value.yamlText,
        yamlDriftDetected: false,
        yamlDriftMessage: null,
        yamlDriftClusterYaml: "",
      }));
      actionNotification = notifySuccess(
        `Applied YAML: ${fresh.target.namespace}/${fresh.target.name}`,
      );
      invalidateConfigurationSnapshotCache();
      mutationReconcile.track({
        ids: [`${fresh.target.namespace}/${fresh.target.name}`],
        expectedEventTypes: ["MODIFIED"],
      });
    } catch (error) {
      const normalizedError = toWorkloadError(error);
      const message = normalizedError.message || "Failed to apply YAML.";
      const normalized = message.toLowerCase();
      const desktopOnlyHint =
        normalized.includes("not available") ||
        normalized.includes("plugin") ||
        normalized.includes("tauri");
      updateYamlTab(tabId, (value) => ({
        ...value,
        yamlError: desktopOnlyHint
          ? "Apply YAML requires desktop runtime with file-system access."
          : message,
      }));
    } finally {
      updateYamlTab(tabId, (value) => ({ ...value, yamlSaving: false }));
      try {
        await remove(relativePath, { baseDir: BaseDirectory.AppData });
      } catch {
        // Ignore temp cleanup failures.
      }
    }
  }

  function parseStringMap(raw: string, field: string): Record<string, string> {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(`${field} must be valid JSON object`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${field} must be JSON object`);
    }
    const map: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "string") {
        throw new Error(`${field} values must be strings`);
      }
      map[key] = value;
    }
    return map;
  }

  function isProtectedNamespaceName(name: string): boolean {
    return SYSTEM_NAMESPACES.has(name);
  }

  function invalidateConfigurationSnapshotCache() {
    if (!workloadKey) return;
    invalidateWorkloadSnapshotCache(clusterId, workloadKey);
  }

  function canDeleteNamespaceRow(row: ConfigurationRow): boolean {
    if (!isNamespacesWorkload) return true;
    return !isProtectedNamespaceName(row.name);
  }

  function removeRowsFromSnapshot(rows: ConfigurationRow[]) {
    const keys = new Set(rows.map((row) => `${row.namespace}/${row.name}`));
    if (watcherPolicy.mode === "stream" && clusterId && workloadKey) {
      for (const row of rows) {
        applyConfigurationItemEvent(clusterId, workloadKey, {
          type: "DELETED",
          object: row.raw,
        });
      }
      return;
    }
    rowsSnapshot = rowsSnapshot.filter((row) => !keys.has(`${row.namespace}/${row.name}`));
  }

  async function applyManifestDocument(manifest: string, contextLabel: string): Promise<void> {
    const relativePath = `tmp/configuration-manifest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.yaml`;
    try {
      await mkdir("tmp", { recursive: true, baseDir: BaseDirectory.AppData });
      await writeTextFile(relativePath, manifest, { baseDir: BaseDirectory.AppData });
      const appDataPath = await path.appDataDir();
      const absolutePath = await path.join(appDataPath, relativePath);
      const dryRun = await kubectlRawArgsFront(["apply", "--dry-run=server", "-f", absolutePath], {
        clusterId,
      });
      if (dryRun.errors || dryRun.code !== 0) {
        throw new Error(
          formatApplyErrorMessage(dryRun.errors || "Server dry-run failed.", contextLabel),
        );
      }
      const result = await kubectlRawArgsFront(["apply", "-f", absolutePath], { clusterId });
      if (result.errors || result.code !== 0) {
        throw new Error(
          formatApplyErrorMessage(result.errors || "Failed to apply YAML.", contextLabel),
        );
      }
      invalidateConfigurationSnapshotCache();
    } finally {
      try {
        await remove(relativePath, { baseDir: BaseDirectory.AppData });
      } catch {
        // Ignore temp cleanup failures.
      }
    }
  }

  async function createNamespace() {
    if (!clusterId || !isNamespacesWorkload) return;
    const name = namespaceCreateName.trim();
    if (!name) {
      errorMessage = "Namespace name is required";
      return;
    }
    actionInFlight = true;
    errorMessage = null;
    try {
      const labels = parseStringMap(namespaceLabelsText, "Labels");
      const annotations = parseStringMap(namespaceAnnotationsText, "Annotations");
      const metadata = {
        name,
        ...(Object.keys(labels).length > 0 ? { labels } : {}),
        ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
      };
      await applyManifestDocument(
        JSON.stringify({
          apiVersion: "v1",
          kind: "Namespace",
          metadata,
        }),
        `namespace/${name}`,
      );
      actionNotification = notifySuccess(`Namespace "${name}" created.`);
      namespaceCreateName = "";
      mutationReconcile.track({
        ids: [`cluster/${name}`],
        expectedEventTypes: ["ADDED"],
      });
    } catch (error) {
      errorMessage = toWorkloadError(error).message || "Failed to create namespace";
    } finally {
      actionInFlight = false;
    }
  }

  async function updateNamespaceMetadata() {
    if (!clusterId || !isNamespacesWorkload) return;
    const name = namespaceTargetName.trim();
    if (!name) {
      errorMessage = "Target namespace is required";
      return;
    }
    actionInFlight = true;
    errorMessage = null;
    try {
      const labels = parseStringMap(namespaceLabelsText, "Labels");
      const annotations = parseStringMap(namespaceAnnotationsText, "Annotations");
      const patchPayload = JSON.stringify({
        metadata: {
          labels,
          annotations,
        },
      });
      const result = await kubectlRawArgsFront(
        ["patch", "namespace", name, "--type=merge", "-p", patchPayload],
        { clusterId },
      );
      if (result.errors || result.code !== 0) {
        throw new Error(result.errors || result.output || `Failed to patch namespace ${name}`);
      }
      actionNotification = notifySuccess(`Namespace "${name}" metadata updated.`);
      invalidateConfigurationSnapshotCache();
      mutationReconcile.track({
        ids: [`cluster/${name}`],
        expectedEventTypes: ["MODIFIED"],
      });
    } catch (error) {
      errorMessage = toWorkloadError(error).message || "Failed to update namespace metadata";
    } finally {
      actionInFlight = false;
    }
  }

  async function forceFinalizeNamespace() {
    if (!clusterId || !isNamespacesWorkload) return;
    const name = namespaceTargetName.trim();
    if (!name) {
      errorMessage = "Target namespace is required";
      return;
    }
    if (isProtectedNamespaceName(name)) {
      errorMessage = `Namespace "${name}" is protected and cannot be force-finalized from UI.`;
      return;
    }
    const confirmed = await confirmAction(
      `Force remove finalizers from namespace "${name}"? Use only when namespace is stuck in Terminating.`,
      "Force finalize namespace",
    );
    if (!confirmed) return;
    actionInFlight = true;
    errorMessage = null;
    try {
      const patchPayload = JSON.stringify({
        spec: { finalizers: [] },
      });
      const result = await kubectlRawArgsFront(
        ["patch", "namespace", name, "--type=merge", "-p", patchPayload],
        { clusterId },
      );
      if (result.errors || result.code !== 0) {
        throw new Error(result.errors || result.output || `Failed to finalize namespace ${name}`);
      }
      actionNotification = notifySuccess(`Finalizers removed for namespace "${name}".`);
      invalidateConfigurationSnapshotCache();
      mutationReconcile.track({
        ids: [`cluster/${name}`],
        expectedEventTypes: ["MODIFIED"],
      });
    } catch (error) {
      errorMessage = toWorkloadError(error).message || "Failed to finalize namespace";
    } finally {
      actionInFlight = false;
    }
  }

  async function bootstrapNamespaceBaseline() {
    if (!clusterId || !isNamespacesWorkload) return;
    const namespace = bootstrapTargetNamespace.trim();
    if (!namespace) {
      errorMessage = "Bootstrap namespace is required";
      return;
    }
    actionInFlight = true;
    errorMessage = null;
    try {
      const manifest = `---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: baseline-quota
  namespace: ${namespace}
spec:
  hard:
    requests.cpu: "4"
    requests.memory: 8Gi
    limits.cpu: "8"
    limits.memory: 16Gi
    pods: "50"
---
apiVersion: v1
kind: LimitRange
metadata:
  name: baseline-limits
  namespace: ${namespace}
spec:
  limits:
    - type: Container
      default:
        cpu: 500m
        memory: 512Mi
      defaultRequest:
        cpu: 100m
        memory: 128Mi
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: ${namespace}
spec:
  podSelector: {}
  policyTypes:
    - Ingress`;
      await applyManifestDocument(manifest, `namespace/${namespace}`);
      actionNotification = notifySuccess(
        `Baseline quota/limits/network policy applied to namespace "${namespace}".`,
      );
      mutationReconcile.schedule();
    } catch (error) {
      errorMessage = toWorkloadError(error).message || "Failed to bootstrap namespace baseline";
    } finally {
      actionInFlight = false;
    }
  }

  async function deleteRows(rows: ConfigurationRow[]) {
    if (!clusterId || rows.length === 0) return;
    actionInFlight = true;
    errorMessage = null;
    try {
      for (const row of rows) {
        if (isNamespacesWorkload && !canDeleteNamespaceRow(row)) {
          throw new Error(`Namespace "${row.name}" is protected and cannot be deleted from UI.`);
        }
        const resource = resourceByWorkload[workloadKey] ?? workloadKey;
        const args = ["delete", resource, row.name];
        if (isNamespaceScoped && row.namespace !== "cluster") {
          args.push("-n", row.namespace);
        }
        const dryRunArgs = [...args, "--dry-run=server", "-o", "name"];
        const dryRun = await kubectlRawArgsFront(dryRunArgs, { clusterId });
        if (dryRun.errors || dryRun.code !== 0) {
          throw new Error(
            dryRun.errors || dryRun.output || `Dry-run delete failed for ${row.name}`,
          );
        }
        const result = await kubectlRawArgsFront(args, { clusterId });
        if (result.errors || result.code !== 0) {
          throw new Error(result.errors || result.output || `Failed to delete ${row.name}`);
        }
      }
      actionNotification = notifySuccess(
        `Deleted ${rows.length} resource${rows.length === 1 ? "" : "s"}`,
      );
      selectedRowIds = new Set();
      removeRowsFromSnapshot(rows);
      invalidateConfigurationSnapshotCache();
      mutationReconcile.track({
        ids: rows.map((row) => `${row.namespace}/${row.name}`),
        expectedEventTypes: ["DELETED"],
      });
    } catch (error) {
      errorMessage = toWorkloadError(error).message || "Delete failed";
    } finally {
      actionInFlight = false;
    }
  }

  function columnEntries() {
    const entries = [
      { id: "name", label: "Name", checked: columnsVisible.name },
      { id: "createdAt", label: "Age", checked: columnsVisible.createdAt },
    ];
    if (workloadKey !== "priorityclasses") {
      entries.push({ id: "resourceVersion", label: "RV", checked: columnsVisible.resourceVersion });
    }
    if (isNamespaceScoped || workloadKey === "ingressclasses") {
      entries.push({ id: "namespace", label: "Namespace", checked: columnsVisible.namespace });
    }
    if (workloadKey === "configmaps" || workloadKey === "secrets") {
      entries.push({ id: "keys", label: "Keys", checked: columnsVisible.keys });
    }
    if (workloadKey === "namespaces" || workloadKey === "secrets") {
      entries.push({ id: "labels", label: "Labels", checked: columnsVisible.labels });
    }
    if (
      workloadKey === "secrets" ||
      workloadKey === "ingressclasses" ||
      workloadKey === "gatewayclasses"
    ) {
      entries.push({ id: "type", label: "Type", checked: columnsVisible.type });
    }
    if (workloadKey === "priorityclasses") {
      entries.push({ id: "value", label: "Value", checked: columnsVisible.value });
      entries.push({
        id: "globalDefault",
        label: "Global default",
        checked: columnsVisible.globalDefault,
      });
    }
    if (workloadKey === "runtimeclasses") {
      entries.push({ id: "handler", label: "Handler", checked: columnsVisible.handler });
    }
    if (workloadKey === "rolebindings" || workloadKey === "clusterrolebindings") {
      entries.push({ id: "bindings", label: "Bindings", checked: columnsVisible.bindings });
    }
    if (workloadKey === "customresourcedefinitions") {
      entries.push({ id: "resource", label: "Resource", checked: columnsVisible.resource });
      entries.push({ id: "group", label: "Group", checked: columnsVisible.group });
      entries.push({ id: "version", label: "Version", checked: columnsVisible.version });
      entries.push({ id: "scope", label: "Scope", checked: columnsVisible.scope });
    }
    if (workloadKey === "leases") {
      entries.push({ id: "holder", label: "Holder", checked: columnsVisible.holder });
    }
    if (
      workloadKey === "mutatingwebhookconfigurations" ||
      workloadKey === "validatingwebhookconfigurations"
    ) {
      entries.push({ id: "webhooks", label: "WebHooks", checked: columnsVisible.webhooks });
    }
    if (
      workloadKey === "namespaces" ||
      workloadKey === "horizontalpodautoscalers" ||
      workloadKey === "volumesnapshots" ||
      workloadKey === "volumesnapshotcontents"
    ) {
      entries.push({ id: "status", label: "Status", checked: columnsVisible.status });
    }
    if (workloadKey === "poddisruptionbudgets") {
      entries.push({
        id: "minAvailable",
        label: "Min available",
        checked: columnsVisible.minAvailable,
      });
      entries.push({
        id: "maxUnavailable",
        label: "Max unavailable",
        checked: columnsVisible.maxUnavailable,
      });
      entries.push({
        id: "currentHealthy",
        label: "Current healthy",
        checked: columnsVisible.currentHealthy,
      });
      entries.push({
        id: "desiredHealthy",
        label: "Desired healthy",
        checked: columnsVisible.desiredHealthy,
      });
    }
    if (workloadKey === "horizontalpodautoscalers") {
      entries.push({ id: "metrics", label: "Metrics", checked: columnsVisible.metrics });
      entries.push({ id: "minPods", label: "Min Pods", checked: columnsVisible.minPods });
      entries.push({ id: "maxPods", label: "Max Pods", checked: columnsVisible.maxPods });
      entries.push({ id: "replicas", label: "Replicas", checked: columnsVisible.replicas });
    }
    if (workloadKey === "services") {
      entries.push({ id: "externalIP", label: "External IP", checked: columnsVisible.externalIP });
      entries.push({ id: "selector", label: "Selector", checked: columnsVisible.selector });
      entries.push({ id: "status", label: "Status", checked: columnsVisible.status });
      entries.push({ id: "ports", label: "Ports", checked: columnsVisible.ports });
    }
    if (workloadKey === "ingresses") {
      entries.push({ id: "ports", label: "Rules", checked: columnsVisible.ports });
      entries.push({
        id: "loadBalancers",
        label: "LoadBalancers",
        checked: columnsVisible.loadBalancers,
      });
    }
    if (workloadKey === "endpoints" || workloadKey === "endpointslices") {
      entries.push({ id: "endpoints", label: "Endpoints", checked: columnsVisible.endpoints });
      if (workloadKey === "endpointslices") {
        entries.push({ id: "ports", label: "Ports", checked: columnsVisible.ports });
        entries.push({ id: "status", label: "Status", checked: columnsVisible.status });
      }
    }
    if (workloadKey === "ingressclasses") {
      entries.push({ id: "controller", label: "Controller", checked: columnsVisible.controller });
      entries.push({ id: "apiGroup", label: "ApiGroup", checked: columnsVisible.apiGroup });
      entries.push({ id: "scope", label: "Scope", checked: columnsVisible.scope });
      entries.push({ id: "kind", label: "Kind", checked: columnsVisible.kind });
    }
    if (workloadKey === "networkpolicies") {
      entries.push({
        id: "policyTypes",
        label: "Policy Types",
        checked: columnsVisible.policyTypes,
      });
    }
    if (
      workloadKey === "persistentvolumeclaims" ||
      workloadKey === "persistentvolumes" ||
      workloadKey === "volumesnapshotcontents"
    ) {
      entries.push({ id: "status", label: "Status", checked: columnsVisible.status });
    }
    if (workloadKey === "persistentvolumeclaims") {
      entries.push({
        id: "storageClass",
        label: "Storage Class",
        checked: columnsVisible.storageClass,
      });
      entries.push({ id: "size", label: "Size", checked: columnsVisible.size });
      entries.push({ id: "pods", label: "Pods", checked: columnsVisible.pods });
    }
    if (workloadKey === "persistentvolumes") {
      entries.push({
        id: "storageClass",
        label: "Storage Class",
        checked: columnsVisible.storageClass,
      });
      entries.push({ id: "capacity", label: "Capacity", checked: columnsVisible.capacity });
      entries.push({ id: "claim", label: "Claim", checked: columnsVisible.claim });
    }
    if (workloadKey === "volumesnapshots") {
      entries.push({
        id: "storageClass",
        label: "Snapshot Class",
        checked: columnsVisible.storageClass,
      });
      entries.push({ id: "size", label: "Restore Size", checked: columnsVisible.size });
      entries.push({ id: "status", label: "Status", checked: columnsVisible.status });
    }
    if (workloadKey === "volumesnapshotcontents") {
      entries.push({ id: "claim", label: "Snapshot Ref", checked: columnsVisible.claim });
      entries.push({ id: "provisioner", label: "Driver", checked: columnsVisible.provisioner });
      entries.push({
        id: "reclaimPolicy",
        label: "Deletion Policy",
        checked: columnsVisible.reclaimPolicy,
      });
      entries.push({ id: "size", label: "Restore Size", checked: columnsVisible.size });
    }
    if (workloadKey === "storageclasses" || workloadKey === "volumesnapshotclasses") {
      entries.push({
        id: "provisioner",
        label: workloadKey === "volumesnapshotclasses" ? "Driver" : "Provisioner",
        checked: columnsVisible.provisioner,
      });
      entries.push({
        id: "reclaimPolicy",
        label: workloadKey === "volumesnapshotclasses" ? "Deletion Policy" : "Reclaim",
        checked: columnsVisible.reclaimPolicy,
      });
      entries.push({
        id: "isDefaultStorageClass",
        label: "Default",
        checked: columnsVisible.isDefaultStorageClass,
      });
    }
    if (workloadKey === "volumeattributesclasses") {
      entries.push({ id: "provisioner", label: "Driver", checked: columnsVisible.provisioner });
    }
    if (workloadKey === "csistoragecapacities") {
      entries.push({
        id: "storageClass",
        label: "Storage Class",
        checked: columnsVisible.storageClass,
      });
      entries.push({ id: "capacity", label: "Capacity", checked: columnsVisible.capacity });
    }
    return entries;
  }

  function toggleColumn(columnId: string, checked: boolean) {
    columnsVisible = {
      ...columnsVisible,
      [columnId]: checked,
    };
  }

  function showAllColumns() {
    columnsVisible = getDefaultColumnsForWorkload();
  }

  function hideAllColumns() {
    columnsVisible = {
      name: false,
      namespace: false,
      createdAt: false,
      keys: false,
      labels: false,
      type: false,
      handler: false,
      holder: false,
      webhooks: false,
      status: false,
      minAvailable: false,
      maxUnavailable: false,
      currentHealthy: false,
      desiredHealthy: false,
      metrics: false,
      minPods: false,
      maxPods: false,
      replicas: false,
      bindings: false,
      resource: false,
      group: false,
      version: false,
      scope: false,
      kind: false,
      controller: false,
      apiGroup: false,
      externalIP: false,
      selector: false,
      endpoints: false,
      loadBalancers: false,
      policyTypes: false,
      storageClass: false,
      size: false,
      pods: false,
      capacity: false,
      resourceVersion: false,
      value: false,
      globalDefault: false,
      serviceType: false,
      clusterIP: false,
      ports: false,
      phase: false,
      storage: false,
      claim: false,
      provisioner: false,
      reclaimPolicy: false,
      isDefaultStorageClass: false,
    };
  }

  $effect(() => {
    if (!clusterId || !workloadKey) {
      loadRowsFromProps();
      return;
    }
    setInitialConfigurationItems(
      clusterId,
      workloadKey,
      Array.isArray(data.items) ? data.items : [],
    );
    if (watcherPolicy.mode !== "stream") {
      loadRowsFromProps();
    }
  });

  $effect(() => {
    if (!clusterId || !workloadKey) return;
    if (initializedScopeKey === scopeKey) return;
    initializedScopeKey = scopeKey;

    if (previousSyncScopeKey && previousSyncScopeKey !== scopeKey) {
      const [previousClusterId, previousWorkloadKey] = previousSyncScopeKey.split(":") as [
        string,
        WorkloadType,
      ];
      setConfigurationSyncEnabled(previousClusterId, previousWorkloadKey, false);
      resetConfigurationSyncStatus(previousClusterId, previousWorkloadKey);
      if (configurationSyncStarted && activeConfigurationSyncScopeKey === previousSyncScopeKey) {
        destroyConfigurationSync(previousClusterId, previousWorkloadKey);
        configurationSyncStarted = false;
        activeConfigurationSyncScopeKey = null;
      }
      configurationSyncStoreUnsubscribe?.();
      configurationSyncStoreUnsubscribe = null;
    }
    previousSyncScopeKey = scopeKey;

    // Route switches reuse this component instance; reset local selection state per workload.
    selectedRowIds = new Set<string>();
    selectedDetail = null;
    detailsOpen = false;
    stopAllPortForwardTabs();
    workbenchTabs = [];
    yamlTabs = [];
    pinnedTabIds = new Set<string>();
    setPaneTabIdsIfChanged([null, null, null]);
    setCollapsedPaneIndexesIfChanged([]);
    yamlCompareSourceTabId = null;
    yamlComparePair = null;
    yamlCompareTargetTabId = null;
    activeWorkbenchTabId = null;
    closedWorkbenchTabs = [];
    pendingRestoredTabs = null;
    workbenchStateRestored = false;
    workbenchCollapsed = false;
    workbenchFullscreen = false;
    workbenchLayout = "single";
    searchInput = "";
    search = "";
    quickFilter = "all";
    sortBy = getDefaultSortForWorkload().by;
    sortDirection = getDefaultSortForWorkload().direction;
    collapsedGroups = new Set<string>();
    columnsVisible = getDefaultColumnsForWorkload();

    namespacesInitialized = false;
    previousAvailableNamespaces = [];
    selectedNamespaces = new Set<string>();

    stopWatcher();
    watcherSettingsLoaded = false;
    tableStateLoaded = false;
    loadWatcherSettings();
    loadTableState();
    loadWorkbenchUiSettings();
    if (!watcherSettingsLoaded) {
      watcherSettingsLoaded = true;
    }
    if (!tableStateLoaded) {
      tableStateLoaded = true;
    }
    applyWatcherMode();
  });

  $effect(() => {
    viewMode;
    collapsedGroups = new Set<string>();
  });

  $effect(() => {
    const available = new Set(quickFilterOptions().map((option) => option.id));
    if (!available.has(quickFilter)) {
      quickFilter = "all";
    }
  });

  $effect(() => {
    orderedWorkbenchTabs;
    const knownIds = new Set(orderedWorkbenchTabs.map((tab) => tab.id));
    setPaneTabIdsIfChanged([
      paneTabIds[0] && knownIds.has(paneTabIds[0]) ? paneTabIds[0] : null,
      paneTabIds[1] && knownIds.has(paneTabIds[1]) ? paneTabIds[1] : null,
      paneTabIds[2] && knownIds.has(paneTabIds[2]) ? paneTabIds[2] : null,
    ]);
    if (activeWorkbenchTabId && !knownIds.has(activeWorkbenchTabId)) {
      activeWorkbenchTabId = orderedWorkbenchTabs[0]?.id ?? null;
    }
    if (workbenchLayout === "dual") {
      setPaneTabIdsIfChanged([paneTabIds[0], paneTabIds[1], null]);
    }
    setCollapsedPaneIndexesIfChanged(collapsedPaneIndexes.filter((idx) => idx < getPaneCount()));
    if (yamlCompareSourceTabId && !knownIds.has(yamlCompareSourceTabId)) {
      yamlCompareSourceTabId = null;
    }
    if (yamlCompareTargetTabId && !knownIds.has(yamlCompareTargetTabId)) {
      yamlCompareTargetTabId = null;
    }
    if (
      yamlComparePair &&
      (!knownIds.has(yamlComparePair[0]) || !knownIds.has(yamlComparePair[1]))
    ) {
      yamlComparePair = null;
      yamlCompareTargetTabId = null;
    }
  });

  $effect(() => {
    if (workbenchStateRestored) return;
    if (!pendingRestoredTabs) {
      workbenchStateRestored = true;
      return;
    }
    const toRestore = pendingRestoredTabs;
    pendingRestoredTabs = null;
    for (const tab of toRestore) {
      void openYamlTarget({ name: tab.name, namespace: tab.namespace }, { scrollIntoView: false });
    }
    workbenchStateRestored = true;
  });

  $effect(() => {
    if (!namespacesInitialized) {
      selectedNamespaces = new Set(availableNamespaces);
      previousAvailableNamespaces = availableNamespaces;
      namespacesInitialized = true;
      return;
    }
    const availableSet = new Set(availableNamespaces);
    const previousSet = new Set(previousAvailableNamespaces);
    const hadAllPreviousSelected = previousAvailableNamespaces.every((ns) =>
      selectedNamespaces.has(ns),
    );
    const next = new Set<string>();
    for (const ns of selectedNamespaces) {
      if (availableSet.has(ns)) next.add(ns);
    }
    if (hadAllPreviousSelected) {
      for (const ns of availableNamespaces) {
        if (!previousSet.has(ns)) next.add(ns);
      }
    }
    const changed =
      next.size !== selectedNamespaces.size || [...next].some((ns) => !selectedNamespaces.has(ns));
    previousAvailableNamespaces = availableNamespaces;
    if (changed) selectedNamespaces = next;
  });

  $effect(() => {
    filteredRows.length;
    if (viewMode !== "flat") return;
    if (!tableScrollHost) return;
    void tick().then(() => {
      syncTableViewport();
    });
  });

  $effect(() => {
    viewMode;
    if (viewMode !== "flat") {
      tableScrollTop = 0;
      return;
    }
    if (!tableScrollHost) return;
    tableScrollHost.scrollTop = 0;
    tableScrollTop = 0;
  });

  $effect(() => {
    if (!shouldUseConfigurationRowsWorker) {
      configurationRowsWorkerResult = null;
      return;
    }
    if (!configurationRowsWorker) return;
    rowsSnapshot;
    selectedNamespaces;
    search;
    quickFilter;
    sortBy;
    sortDirection;
    scheduleConfigurationRowsWorker();
  });

  onMount(() => {
    startConfigurationRowsWorker();
    loadWatcherSettings();
    loadTableState();
    loadWorkbenchUiSettings();
    loadSavedViewsForScope();

    if (typeof window !== "undefined") {
      const routeState = decodeWorkbenchRouteState(window.location.search);
      if (routeState.query) {
        searchInput = routeState.query;
        search = routeState.query;
      }
      const url = new URL(window.location.href);
      const sort = url.searchParams.get("sort");
      const dir = url.searchParams.get("dir");
      const quick = url.searchParams.get("quick");
      const view = url.searchParams.get("view");
      if (sort) sortBy = sort as SortBy;
      if (dir === "asc" || dir === "desc") sortDirection = dir;
      if (quick) quickFilter = quick as QuickFilterId;
      if (view === "flat" || view === "namespace") viewMode = view;
    }
    freshnessTimer = setInterval(() => {
      freshnessNow = Date.now();
    }, 10000);
    if (!watcherSettingsLoaded) {
      watcherSettingsLoaded = true;
    }
    if (!tableStateLoaded) {
      tableStateLoaded = true;
    }
    const handleResize = () => syncTableViewport();
    const handleVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible") {
        if (watcherPolicy.enabled) applyWatcherMode();
        return;
      }
      stopWatcher();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("resize", handleResize);
      void tick().then(() => {
        syncTableViewport();
      });
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }
    applyWatcherMode();

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", handleResize);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    };
  });

  $effect(() => {
    clusterId;
    workloadKey;
    loadSavedViewsForScope();
  });

  $effect(() => {
    if ($dashboardDataProfile.id !== "realtime") return;
    if (workbenchCollapsed) workbenchCollapsed = false;
    if (collapsedPaneIndexes.length > 0) collapsedPaneIndexes = [];
  });

  $effect(() => {
    if (!workbenchStateRestored) return;
    yamlTabs;
    closedWorkbenchTabs;
    pinnedTabIds;
    paneTabIds;
    collapsedPaneIndexes;
    activeWorkbenchTabId;
    yamlCompareSourceTabId;
    yamlComparePair;
    yamlCompareTargetTabId;
    workbenchLayout;
    workbenchCollapsed;
    workbenchFullscreen;
    persistWorkbenchUiSettings();
  });

  $effect(() => {
    if (typeof window === "undefined") return;
    search;
    const current = decodeWorkbenchRouteState(window.location.search);
    const next = encodeWorkbenchRouteState({
      ...current,
      query: search.trim() || undefined,
    });
    const nextParams = new URLSearchParams(window.location.search);
    for (const key of ["resource", "ns", "tab", "pane", "compare", "q"]) {
      nextParams.delete(key);
    }
    const nextWorkbenchParams = new URLSearchParams(next);
    for (const [key, value] of nextWorkbenchParams.entries()) {
      nextParams.set(key, value);
    }
    const nextSearch = nextParams.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl === currentUrl) return;
    window.history.replaceState(null, "", nextUrl);
  });

  $effect(() => {
    if (!tableStateLoaded) return;
    if (!clusterId || !workloadKey) return;
    sortBy;
    sortDirection;
    quickFilter;
    persistTableState();
  });

  onDestroy(() => {
    stopAllPortForwardTabs();
    detailsActions.abortAll();
    stopConfigurationRowsWorker();
    stopWatcher();
    mutationReconcile.clearScope();
    configurationSyncStoreUnsubscribe?.();
    configurationSyncStoreUnsubscribe = null;
    if (freshnessTimer) {
      clearInterval(freshnessTimer);
      freshnessTimer = null;
    }
    if (clusterId && workloadKey) {
      if (activeConfigurationSyncScopeKey === `${clusterId}:${workloadKey}`) {
        destroyConfigurationSync(clusterId, workloadKey);
        activeConfigurationSyncScopeKey = null;
      }
      resetConfigurationSyncStatus(clusterId, workloadKey);
    }
  });
</script>

<div class="space-y-4">
  {#if hasWorkbenchTabs}
    <div bind:this={workbenchRootEl}>
      <MultiPaneWorkbench
        tabs={orderedWorkbenchTabs}
        activeTabId={activeWorkbenchTabId}
        {isTabPinned}
        onActivateTab={setActiveWorkbenchTab}
        onTogglePin={togglePinTab}
        onCloseTab={requestCloseWorkbenchTab}
        onReopenLastClosedTab={reopenLastClosedTab}
        reopenDisabled={closedWorkbenchTabs.length === 0}
        layout={workbenchLayout}
        onLayoutChange={(nextLayout) => {
          void requestWorkbenchLayout(nextLayout as WorkbenchLayout);
        }}
        fullscreen={workbenchFullscreen}
        onToggleFullscreen={toggleWorkbenchFullscreen}
        collapsed={workbenchCollapsed}
        onToggleCollapse={toggleWorkbenchCollapse}
      >
        {#snippet tabActions(tab)}
          {#if tab.kind === "yaml"}
            <button
              type="button"
              class={`rounded p-2 text-xs ${
                yamlCompareSourceTabId === tab.id
                  ? "bg-sky-100 text-sky-900"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              onclick={() => selectYamlForCompare(tab.id)}
              title={yamlCompareSourceTabId === tab.id
                ? "Selected for compare"
                : "Select for compare"}
              aria-label={yamlCompareSourceTabId === tab.id
                ? "Selected for compare"
                : "Select for compare"}
            >
              <Target class="h-4 w-4" />
            </button>
            <button
              type="button"
              class={`rounded p-2 text-xs ${
                isYamlCompareTarget(tab.id)
                  ? "bg-sky-100 text-sky-900"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              } disabled:opacity-50`}
              disabled={!canCompareWithSelected(tab.id)}
              onclick={() => compareYamlWithSelected(tab.id)}
              title={!yamlCompareSourceTabId
                ? "Set as compare source"
                : yamlCompareSourceTabId === tab.id
                  ? "Clear compare source"
                  : isYamlCompareTarget(tab.id)
                    ? "Disable compare"
                    : "Compare with selected"}
              aria-label="Compare with selected"
            >
              <GitCompareArrows class="h-4 w-4" />
            </button>
          {/if}
        {/snippet}
        {#snippet body()}
          {#if !workbenchCollapsed && activeWorkbenchTab}
            <div
              class={workbenchFullscreen
                ? "min-h-0 flex-1"
                : activeWorkbenchTab.kind === "port-forward"
                  ? "h-auto min-h-0"
                  : "h-[min(70dvh,760px)] min-h-[430px]"}
            >
              {#if workbenchLayout === "single"}
                {#if activeWorkbenchTab.kind === "yaml"}
                  <ResourceYamlSheet
                    embedded={true}
                    isOpen={workbenchOpen}
                    podRef={activeYamlTab
                      ? `${activeYamlTab.target.namespace}/${activeYamlTab.target.name}`
                      : "-"}
                    originalYaml={activeYamlTab?.yamlOriginalText ?? ""}
                    yamlText={activeYamlTab?.yamlText ?? ""}
                    loading={activeYamlTab?.yamlLoading ?? false}
                    saving={activeYamlTab?.yamlSaving ?? false}
                    hasChanges={(activeYamlTab?.yamlText ?? "") !==
                      (activeYamlTab?.yamlOriginalText ?? "")}
                    externalDiffLines={activeYamlTab
                      ? getYamlCompareDiffLines(activeYamlTab.id)
                      : []}
                    error={activeYamlTab?.yamlError ?? null}
                    driftDetected={activeYamlTab?.yamlDriftDetected ?? false}
                    driftMessage={activeYamlTab?.yamlDriftMessage ?? null}
                    onYamlChange={(value) => {
                      if (!activeYamlTab) return;
                      updateYamlTab(activeYamlTab.id, (tab) => ({ ...tab, yamlText: value }));
                    }}
                    onRefresh={() => {
                      if (!activeYamlTab) return;
                      void loadYamlForTab(activeYamlTab.id);
                    }}
                    onSave={() => {
                      if (!activeYamlTab) return;
                      void saveYamlTab(activeYamlTab.id);
                    }}
                    onReloadFromCluster={() => {
                      if (!activeYamlTab) return;
                      void loadYamlForTab(activeYamlTab.id);
                    }}
                    onRebaseEdits={() => {
                      if (!activeYamlTab) return;
                      rebaseYamlTabEdits(activeYamlTab.id);
                    }}
                  />
                {:else}
                  {@const activePortForwardTab = getPortForwardTab(activeWorkbenchTab.id)}
                  <PortForwardBrowserTab
                    title={activeWorkbenchTab.title}
                    url={activePortForwardTab?.url ?? "about:blank"}
                    loading={activePortForwardTab?.loading ?? false}
                    message={activePortForwardTab?.statusMessage ?? null}
                    onRefresh={() => refreshPortForwardTab(activeWorkbenchTab.id)}
                    onCopyUrl={() => void copyPortForwardUrl(activeWorkbenchTab.id)}
                    onOpenPreview={() => void openPortForwardTabInAppWindow(activeWorkbenchTab.id)}
                    onOpenExternal={() =>
                      void openUrlInExternalBrowser(
                        activePortForwardTab?.url ?? "http://127.0.0.1",
                      )}
                    onStop={() => void stopPortForwardTab(activeWorkbenchTab.id)}
                    stopBusy={activePortForwardTab?.loading ?? false}
                    stopLabel="Stopping..."
                  />
                {/if}
              {:else}
                <div class="flex h-full gap-2 p-2">
                  {#each getPaneIndexes() as paneIndex}
                    {@const paneTab = getPaneTab(paneIndex)}
                    <div
                      class={`${getPaneWrapperClass(paneIndex)} min-h-0 overflow-hidden rounded border`}
                    >
                      <div class="flex items-center gap-2 border-b px-2 py-1.5 text-xs">
                        <span class="text-muted-foreground">Pane {paneIndex + 1}</span>
                        <select
                          class="h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          value={paneTabIds[paneIndex] ?? ""}
                          onchange={(event) => {
                            const value = event.currentTarget.value;
                            assignTabToPane(paneIndex, value || null);
                          }}
                        >
                          <option value="">Select tab</option>
                          {#each orderedWorkbenchTabs as tab}
                            <option value={tab.id}>
                              {tab.title} · {tab.subtitle}
                            </option>
                          {/each}
                        </select>
                      </div>
                      {#if paneTab}
                        {#if paneTab.kind === "yaml"}
                          {@const paneYamlTab = getYamlTab(paneTab.id)}
                          <ResourceYamlSheet
                            embedded={true}
                            isOpen={workbenchOpen}
                            podRef={paneYamlTab
                              ? `${paneYamlTab.target.namespace}/${paneYamlTab.target.name}`
                              : "-"}
                            originalYaml={paneYamlTab?.yamlOriginalText ?? ""}
                            yamlText={paneYamlTab?.yamlText ?? ""}
                            loading={paneYamlTab?.yamlLoading ?? false}
                            saving={paneYamlTab?.yamlSaving ?? false}
                            hasChanges={(paneYamlTab?.yamlText ?? "") !==
                              (paneYamlTab?.yamlOriginalText ?? "")}
                            externalDiffLines={paneYamlTab
                              ? getYamlCompareDiffLines(paneYamlTab.id)
                              : []}
                            error={paneYamlTab?.yamlError ?? null}
                            driftDetected={paneYamlTab?.yamlDriftDetected ?? false}
                            driftMessage={paneYamlTab?.yamlDriftMessage ?? null}
                            canVerticalCollapse={getPaneCount() > 1}
                            isVerticallyCollapsed={isPaneCollapsed(paneIndex)}
                            onToggleVerticalCollapse={() => togglePaneCollapsed(paneIndex)}
                            onYamlChange={(value) => {
                              if (!paneYamlTab) return;
                              updateYamlTab(paneYamlTab.id, (tab) => ({ ...tab, yamlText: value }));
                            }}
                            onRefresh={() => {
                              if (!paneYamlTab) return;
                              void loadYamlForTab(paneYamlTab.id);
                            }}
                            onSave={() => {
                              if (!paneYamlTab) return;
                              void saveYamlTab(paneYamlTab.id);
                            }}
                            onReloadFromCluster={() => {
                              if (!paneYamlTab) return;
                              void loadYamlForTab(paneYamlTab.id);
                            }}
                            onRebaseEdits={() => {
                              if (!paneYamlTab) return;
                              rebaseYamlTabEdits(paneYamlTab.id);
                            }}
                          />
                        {:else}
                          {@const panePortForwardTab = getPortForwardTab(paneTab.id)}
                          <PortForwardBrowserTab
                            title={paneTab.title}
                            url={panePortForwardTab?.url ?? "about:blank"}
                            loading={panePortForwardTab?.loading ?? false}
                            message={panePortForwardTab?.statusMessage ?? null}
                            onRefresh={() => refreshPortForwardTab(paneTab.id)}
                            onCopyUrl={() => void copyPortForwardUrl(paneTab.id)}
                            onOpenPreview={() => void openPortForwardTabInAppWindow(paneTab.id)}
                            onOpenExternal={() =>
                              void openUrlInExternalBrowser(
                                panePortForwardTab?.url ?? "http://127.0.0.1",
                              )}
                            onStop={() => void stopPortForwardTab(paneTab.id)}
                            stopBusy={panePortForwardTab?.loading ?? false}
                            stopLabel="Stopping..."
                          />
                        {/if}
                      {:else}
                        <div
                          class="flex h-full items-center justify-center p-4 text-sm text-muted-foreground"
                        >
                          Select tab for pane {paneIndex + 1}
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        {/snippet}
      </MultiPaneWorkbench>
    </div>
  {/if}

  {#if selectedRows.length > 0}
    <WorkloadSelectionBar count={selectedRows.length}>
      {#snippet children()}
        <ConfigurationBulkActions
          mode={bulkMode}
          disabled={bulkDisabled}
          onShowDetails={() => {
            const row = firstSelected();
            if (row) showDetails(row);
          }}
          onEditYaml={() => {
            const row = firstSelected();
            if (row) void openYamlEditor(row);
          }}
          onCopyKubectlGetYaml={() => {
            const row = firstSelected();
            if (!row) return;
            void copyTextToClipboard(
              buildGetYamlCommand(row),
              `Copied command for ${row.namespace}/${row.name}`,
            );
          }}
          onCopyKubectlDescribe={() => {
            const row = firstSelected();
            if (!row) return;
            void copyTextToClipboard(
              buildDescribeCommand(row),
              `Copied describe command for ${row.namespace}/${row.name}`,
            );
          }}
          onRunDebugDescribe={() => {
            const row = firstSelected();
            if (!row) return;
            openDebugDescribeForRow(row);
          }}
          onPortForward={workloadKey === "services"
            ? () => {
                const row = firstSelected();
                if (row) void openServicePortForward(row);
              }
            : undefined}
          onDelete={deleteSelectedRows}
        />
        <Button variant="outline" size="sm" onclick={() => (selectedRowIds = new Set<string>())}
          >Clear</Button
        >
      {/snippet}
    </WorkloadSelectionBar>
  {/if}

  {#if isNamespacesWorkload}
    <div class="mb-3 rounded-lg border border-border bg-background/60 p-3">
      <p class="text-sm font-semibold">Namespace lifecycle</p>
      <p class="mt-1 text-xs text-muted-foreground">
        Create namespaces, update labels/annotations, force finalize stuck namespaces, and apply
        baseline guardrails (ResourceQuota, LimitRange, default-deny ingress policy).
      </p>
      <div class="mt-3 grid gap-3 lg:grid-cols-2">
        <div class="rounded border border-border p-3">
          <p class="text-xs font-medium text-muted-foreground">Create namespace</p>
          <div class="mt-2 grid gap-2">
            <Input placeholder="Namespace name" bind:value={namespaceCreateName} />
            <Input
              placeholder={`Labels JSON, e.g. {"team":"backend","env":"staging"}`}
              bind:value={namespaceLabelsText}
            />
            <Input
              placeholder={`Annotations JSON, e.g. {"owner":"sre-team","cost-center":"platform"}`}
              bind:value={namespaceAnnotationsText}
            />
            <Button variant="outline" size="sm" loading={actionInFlight} onclick={createNamespace}>
              Create Namespace
            </Button>
          </div>
        </div>
        <div class="rounded border border-border p-3">
          <p class="text-xs font-medium text-muted-foreground">Update/finalize namespace</p>
          <div class="mt-2 grid gap-2">
            <Input placeholder="Target namespace" bind:value={namespaceTargetName} />
            <Input
              placeholder={`Labels JSON, e.g. {"team":"backend","env":"staging"}`}
              bind:value={namespaceLabelsText}
            />
            <Input
              placeholder={`Annotations JSON, e.g. {"owner":"sre-team","cost-center":"platform"}`}
              bind:value={namespaceAnnotationsText}
            />
            <div class="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={actionInFlight}
                onclick={updateNamespaceMetadata}
              >
                Update metadata
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={actionInFlight}
                onclick={forceFinalizeNamespace}
              >
                Force finalize
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div class="mt-3 rounded border border-border p-3">
        <p class="text-xs font-medium text-muted-foreground">Namespace bootstrap baseline</p>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <Input
            class="w-full max-w-sm"
            placeholder="Namespace"
            bind:value={bootstrapTargetNamespace}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={actionInFlight}
            onclick={bootstrapNamespaceBaseline}
          >
            Apply baseline
          </Button>
        </div>
      </div>
    </div>
  {/if}

  <ResourceSummaryStrip
    items={[
      { label: "Cluster", value: data.name || data.slug, tone: "foreground" },
      { label: isNamespacesWorkload ? "Scope" : "Namespace", value: configurationScopeSummary },
      { label: tableTitle, value: filteredRows.length },
      { label: "Sync", value: configurationRuntimeSourceState },
    ]}
    trailingItem={{
      label: "View",
      value: configurationSummaryView,
      valueClass: "text-foreground",
    }}
  />
  <div class="mb-3">
    <SectionRuntimeStatus
      sectionLabel={configurationRuntimeSectionLabel}
      profileLabel={configurationRuntimeProfileLabel}
      sourceState={configurationRuntimeSourceState}
      mode={watcherPolicy.mode === "stream" ? "stream" : "poll"}
      budgetSummary={`sync ${watcherPolicy.refreshSeconds}s`}
      detail={configurationRuntimeDetail}
      secondaryActionLabel="Update"
      secondaryActionAriaLabel={`Refresh ${tableTitle} runtime section`}
      secondaryActionLoading={actionInFlight}
      onSecondaryAction={() => void refreshNow("manual")}
      reason={configurationRuntimeReason}
      actionLabel={watcherEnabled ? "Pause section" : "Resume section"}
      actionAriaLabel={watcherEnabled
        ? "Pause configuration runtime section"
        : "Resume configuration runtime section"}
      onAction={toggleWatcher}
    />
  </div>
  {#if watcherError}
    <div
      class="mb-3 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-800"
    >
      {watcherError}
    </div>
  {/if}
  {#if watcherIsStale}
    <div
      class="mb-3 rounded-md border border-rose-300/60 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-950/30 dark:text-rose-300"
    >
      Watcher freshness SLO breached: data is stale. Last successful sync was
      {lastWatcherSuccessAt
        ? ` ${getTimeDifference(new Date(lastWatcherSuccessAt))} ago`
        : " unavailable"}.
    </div>
  {/if}
  <ActionNotificationBar
    notification={actionNotification}
    onDismiss={() => {
      actionNotification = null;
    }}
  />
  {#if errorMessage}
    <Alert.Root variant="destructive" class="mb-4">
      <button
        type="button"
        class="absolute right-2 top-2 rounded bg-rose-100/70 p-1.5 text-xs text-rose-700 transition hover:bg-rose-200 dark:bg-rose-500/20 dark:text-rose-300 dark:hover:bg-rose-500/30"
        aria-label="Close notification"
        title="Close"
        onclick={() => {
          errorMessage = null;
        }}
      >
        <X class="h-3.5 w-3.5" />
      </button>
      <Alert.Description>{errorMessage}</Alert.Description>
    </Alert.Root>
  {/if}
  {#if isNamespacesWorkload && selectedRowsBlockedByPolicy.length > 0}
    <div
      class="mb-3 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-800"
    >
      Protected namespaces selected: {selectedRowsBlockedByPolicy
        .map((row) => row.name)
        .join(", ")}. Delete is blocked for these namespaces.
    </div>
  {/if}

  <TableToolbarShell>
    {#snippet children()}
      <Input
        class="w-full max-w-xl"
        placeholder={`Filter ${tableTitle.toLowerCase()}...`}
        value={searchInput}
        oninput={(event) => setSearchQuery((event.currentTarget as HTMLInputElement).value)}
      />
    {/snippet}
    {#snippet actions()}
      {#if !isNamespacesWorkload}
        <TableChecklistDropdown
          label={`NS (${selectedNamespaces.size}/${availableNamespaces.length})`}
          entries={namespaceEntries}
          onToggle={toggleNamespace}
          onSelectAll={selectAllNamespaces}
          onClearAll={clearAllNamespaces}
        />
      {/if}
      <TableChecklistDropdown
        label="Columns"
        entries={columnEntries()}
        onToggle={toggleColumn}
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
      <div class="flex items-center gap-1 rounded border bg-background p-1">
        <button
          type="button"
          class={`rounded p-1.5 ${viewMode === "flat" ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          onclick={() => setTableViewMode("flat")}
          title="Flat list"
          aria-label="Flat list"
        >
          <List class="h-4 w-4" />
        </button>
        <button
          type="button"
          class={`rounded p-1.5 ${viewMode === "namespace" ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          onclick={() => setTableViewMode("namespace")}
          title="Group by namespace"
          aria-label="Group by namespace"
        >
          <Layers3 class="h-4 w-4" />
        </button>
      </div>
      <WatcherToolbarControls
        {watcherEnabled}
        {watcherRefreshSeconds}
        onToggleWatcher={toggleWatcher}
        onWatcherRefreshSecondsChange={setWatcherRefresh}
        onResetWatcherSettings={resetWatcherSettings}
      />
      {#if hasGroupedRows}
        <Button variant="outline" size="sm" onclick={toggleAllGroups}>
          {getGroupCollapseToggleLabel(collapsedGroups, groupKeys)}
        </Button>
      {/if}
    {/snippet}
  </TableToolbarShell>

  <TableSurface
    maxHeightClass={viewMode === "flat" ? "max-h-[70vh]" : ""}
    onScroll={handleTableScroll}
    bind:ref={tableScrollHost}
  >
    <Table.Table class="table-fixed">
      <Table.TableCaption>{tableTitle}</Table.TableCaption>
      <Table.TableHeader>
        <Table.TableRow>
          <Table.TableHead class="w-10">
            <ConfigurationSelectionCheckbox
              checked={allVisibleSelected}
              indeterminate={someVisibleSelected}
              label="Select all rows"
              onToggle={toggleAllRows}
            />
          </Table.TableHead>
          <Table.TableHead class="w-20">
            <span class="text-[11px] uppercase tracking-wide">Actions</span>
          </Table.TableHead>
          {#if columnsVisible.name}
            <Table.TableHead class="w-[28%]">
              <SortingButton label="Name" onclick={() => toggleSort("name")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.namespace}
            <Table.TableHead class="w-[18%]">
              <SortingButton label="Namespace" onclick={() => toggleSort("namespace")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.createdAt}
            <Table.TableHead class="w-[18%]">
              <SortingButton label="Age" onclick={() => toggleSort("createdAt")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.keys}
            <Table.TableHead class="w-[90px]">
              <SortingButton label="Keys" onclick={() => toggleSort("keys")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.labels}
            <Table.TableHead class="w-[220px]">
              <SortingButton label="Labels" onclick={() => toggleSort("labels")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.type}
            <Table.TableHead class="w-[180px]">
              <SortingButton label="Type" onclick={() => toggleSort("type")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.handler}
            <Table.TableHead class="w-[180px]">
              <SortingButton label="Handler" onclick={() => toggleSort("handler")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.holder}
            <Table.TableHead class="w-[180px]">
              <SortingButton label="Holder" onclick={() => toggleSort("holder")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.webhooks}
            <Table.TableHead class="w-[110px]">
              <SortingButton label="WebHooks" onclick={() => toggleSort("webhooks")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.status}
            <Table.TableHead class="w-[130px]">
              <SortingButton label="Status" onclick={() => toggleSort("status")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.minAvailable}
            <Table.TableHead class="w-[170px]">
              <SortingButton label="Min available" onclick={() => toggleSort("minAvailable")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.maxUnavailable}
            <Table.TableHead class="w-[180px]">
              <SortingButton label="Max unavailable" onclick={() => toggleSort("maxUnavailable")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.currentHealthy}
            <Table.TableHead class="w-[180px]">
              <SortingButton label="Current healthy" onclick={() => toggleSort("currentHealthy")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.desiredHealthy}
            <Table.TableHead class="w-[180px]">
              <SortingButton label="Desired healthy" onclick={() => toggleSort("desiredHealthy")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.metrics}
            <Table.TableHead class="w-[100px]">
              <SortingButton label="Metrics" onclick={() => toggleSort("metrics")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.minPods}
            <Table.TableHead class="w-[100px]">
              <SortingButton label="Min Pods" onclick={() => toggleSort("minPods")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.maxPods}
            <Table.TableHead class="w-[100px]">
              <SortingButton label="Max Pods" onclick={() => toggleSort("maxPods")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.replicas}
            <Table.TableHead class="w-[110px]">
              <SortingButton label="Replicas" onclick={() => toggleSort("replicas")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.bindings}
            <Table.TableHead class="w-[220px]">
              <SortingButton label="Bindings" onclick={() => toggleSort("bindings")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.resource}
            <Table.TableHead class="w-[180px]">
              <SortingButton label="Resource" onclick={() => toggleSort("resource")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.group}
            <Table.TableHead class="w-[220px]">
              <SortingButton label="Group" onclick={() => toggleSort("group")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.version}
            <Table.TableHead class="w-[120px]">
              <SortingButton label="Version" onclick={() => toggleSort("version")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.scope}
            <Table.TableHead class="w-[130px]">
              <SortingButton label="Scope" onclick={() => toggleSort("scope")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.kind}
            <Table.TableHead class="w-[120px]">
              <SortingButton label="Kind" onclick={() => toggleSort("kind")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.controller}
            <Table.TableHead class="w-[220px]">
              <SortingButton label="Controller" onclick={() => toggleSort("controller")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.apiGroup}
            <Table.TableHead class="w-[220px]">
              <SortingButton label="ApiGroup" onclick={() => toggleSort("apiGroup")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.externalIP}
            <Table.TableHead class="w-[200px]">
              <SortingButton label="External IP" onclick={() => toggleSort("externalIP")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.selector}
            <Table.TableHead class="w-[240px]">
              <SortingButton label="Selector" onclick={() => toggleSort("selector")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.endpoints}
            <Table.TableHead class="w-[180px]">
              <SortingButton label="Endpoints" onclick={() => toggleSort("endpoints")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.loadBalancers}
            <Table.TableHead class="w-[220px]">
              <SortingButton label="LoadBalancers" onclick={() => toggleSort("loadBalancers")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.policyTypes}
            <Table.TableHead class="w-[180px]">
              <SortingButton label="Policy Types" onclick={() => toggleSort("policyTypes")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.storageClass}
            <Table.TableHead class="w-[170px]">
              <SortingButton
                label={workloadKey === "volumesnapshots" ? "Snapshot Class" : "Storage Class"}
                onclick={() => toggleSort("storageClass")}
              />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.size}
            <Table.TableHead class="w-[110px]">
              <SortingButton
                label={workloadKey === "volumesnapshots" || workloadKey === "volumesnapshotcontents"
                  ? "Restore Size"
                  : "Size"}
                onclick={() => toggleSort("size")}
              />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.pods}
            <Table.TableHead class="w-[100px]">
              <SortingButton label="Pods" onclick={() => toggleSort("pods")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.capacity}
            <Table.TableHead class="w-[130px]">
              <SortingButton label="Capacity" onclick={() => toggleSort("capacity")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.serviceType}
            <Table.TableHead class="w-[140px]">
              <SortingButton label="Type" onclick={() => toggleSort("serviceType")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.clusterIP}
            <Table.TableHead class="w-[150px]">
              <SortingButton label="ClusterIP" onclick={() => toggleSort("clusterIP")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.ports}
            <Table.TableHead class="w-[100px]">
              <SortingButton
                label={workloadKey === "ingresses" ? "Rules" : "Ports"}
                onclick={() => toggleSort("ports")}
              />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.phase}
            <Table.TableHead class="w-[120px]">
              <SortingButton label="Status" onclick={() => toggleSort("phase")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.storage}
            <Table.TableHead class="w-[110px]">
              <SortingButton label="Storage" onclick={() => toggleSort("storage")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.claim}
            <Table.TableHead class="w-[190px]">
              <SortingButton
                label={workloadKey === "volumesnapshotcontents" ? "Snapshot Ref" : "Claim"}
                onclick={() => toggleSort("claim")}
              />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.provisioner}
            <Table.TableHead class="w-[220px]">
              <SortingButton
                label={workloadKey === "volumeattributesclasses" ||
                workloadKey === "volumesnapshotcontents" ||
                workloadKey === "volumesnapshotclasses"
                  ? "Driver"
                  : "Provisioner"}
                onclick={() => toggleSort("provisioner")}
              />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.reclaimPolicy}
            <Table.TableHead class="w-[120px]">
              <SortingButton
                label={workloadKey === "volumesnapshotcontents" ||
                workloadKey === "volumesnapshotclasses"
                  ? "Deletion Policy"
                  : "Reclaim"}
                onclick={() => toggleSort("reclaimPolicy")}
              />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.isDefaultStorageClass}
            <Table.TableHead class="w-[100px]">
              <SortingButton label="Default" onclick={() => toggleSort("isDefaultStorageClass")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.resourceVersion}
            <Table.TableHead class="w-[110px]">
              <SortingButton label="RV" onclick={() => toggleSort("resourceVersion")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.value}
            <Table.TableHead class="w-[120px]">
              <SortingButton label="Value" onclick={() => toggleSort("value")} />
            </Table.TableHead>
          {/if}
          {#if columnsVisible.globalDefault}
            <Table.TableHead class="w-[150px]">
              <SortingButton label="Global default" onclick={() => toggleSort("globalDefault")} />
            </Table.TableHead>
          {/if}
        </Table.TableRow>
      </Table.TableHeader>
      <Table.TableBody>
        {#if filteredRows.length === 0}
          <Table.TableRow>
            <Table.TableCell
              colspan={2 + visibleDataColumnCount}
              class="text-center text-sm text-muted-foreground"
            >
              No results for the current filter.
            </Table.TableCell>
          </Table.TableRow>
        {:else if viewMode === "flat"}
          {#if shouldVirtualizeFlatRows && flatVirtualWindow.paddingTop > 0}
            <Table.TableRow aria-hidden="true">
              <Table.TableCell
                colspan={2 + visibleDataColumnCount}
                style={`height: ${flatVirtualWindow.paddingTop}px; padding: 0; border: 0;`}
              ></Table.TableCell>
            </Table.TableRow>
          {/if}
          {#each flatVisibleRows as row (row.uid)}
            <Table.TableRow
              data-state={selectedRowIds.has(row.uid) ? "selected" : undefined}
              onclick={() => showDetails(row)}
              class="cursor-pointer"
            >
              <Table.TableCell>
                <ConfigurationSelectionCheckbox
                  checked={selectedRowIds.has(row.uid)}
                  label={`Select ${row.namespace}/${row.name}`}
                  onToggle={(checked) => toggleRow(row.uid, checked)}
                />
              </Table.TableCell>
              <Table.TableCell class="w-12" onclick={(event) => event.stopPropagation()}>
                <ConfigurationActionsMenu
                  name={row.name}
                  namespace={row.namespace}
                  disabled={actionInFlight}
                  isBusy={actionInFlight}
                  onShowDetails={() => showDetails(row)}
                  onEditYaml={() => void openYamlEditor(row)}
                  onCopyKubectlGetYaml={() =>
                    void copyTextToClipboard(
                      buildGetYamlCommand(row),
                      `Copied command for ${row.namespace}/${row.name}`,
                    )}
                  onCopyKubectlDescribe={() =>
                    void copyTextToClipboard(
                      buildDescribeCommand(row),
                      `Copied describe command for ${row.namespace}/${row.name}`,
                    )}
                  onRunDebugDescribe={() => openDebugDescribeForRow(row)}
                  onPortForward={workloadKey === "services"
                    ? () => void openServicePortForward(row)
                    : undefined}
                  onDelete={() => void deleteRows([row])}
                />
              </Table.TableCell>
              {#if columnsVisible.name}
                <Table.TableCell class="truncate">
                  <div class="flex items-center gap-2">
                    <span class="truncate">{row.name}</span>
                    {#if isRbacWorkload() && row.rbacRiskScore > 0}
                      <span
                        class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          getRbacRiskSeverity(row.rbacRiskScore) === "Critical"
                            ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-400"
                            : getRbacRiskSeverity(row.rbacRiskScore) === "High"
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400"
                              : "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-400"
                        }`}
                        title={`${getRbacRiskSeverity(row.rbacRiskScore)} risk (score ${row.rbacRiskScore}): ${getRbacRiskFindings(
                          row,
                        )
                          .map((f) => f.description)
                          .join("; ")}`}
                      >
                        {getRbacRiskSeverity(row.rbacRiskScore)}
                        {row.rbacRiskScore}
                      </span>
                    {/if}
                    {#if row.driftDetected}
                      <span
                        class="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                      >
                        Drift
                      </span>
                    {/if}
                  </div>
                </Table.TableCell>
              {/if}
              {#if columnsVisible.namespace}
                <Table.TableCell class="truncate">{row.namespace}</Table.TableCell>
              {/if}
              {#if columnsVisible.createdAt}
                <Table.TableCell>{row.age}</Table.TableCell>
              {/if}
              {#if columnsVisible.keys}
                <Table.TableCell>{row.keys}</Table.TableCell>
              {/if}
              {#if columnsVisible.labels}
                <Table.TableCell class="truncate">{row.labels}</Table.TableCell>
              {/if}
              {#if columnsVisible.type}
                <Table.TableCell class="truncate">{row.type}</Table.TableCell>
              {/if}
              {#if columnsVisible.handler}
                <Table.TableCell class="truncate">{row.handler}</Table.TableCell>
              {/if}
              {#if columnsVisible.holder}
                <Table.TableCell class="truncate">{row.holder}</Table.TableCell>
              {/if}
              {#if columnsVisible.webhooks}
                <Table.TableCell>{row.webhooks}</Table.TableCell>
              {/if}
              {#if columnsVisible.status}
                <Table.TableCell>{row.status}</Table.TableCell>
              {/if}
              {#if columnsVisible.minAvailable}
                <Table.TableCell>{row.minAvailable}</Table.TableCell>
              {/if}
              {#if columnsVisible.maxUnavailable}
                <Table.TableCell>{row.maxUnavailable}</Table.TableCell>
              {/if}
              {#if columnsVisible.currentHealthy}
                <Table.TableCell>{row.currentHealthy}</Table.TableCell>
              {/if}
              {#if columnsVisible.desiredHealthy}
                <Table.TableCell>{row.desiredHealthy}</Table.TableCell>
              {/if}
              {#if columnsVisible.metrics}
                <Table.TableCell>{row.metrics}</Table.TableCell>
              {/if}
              {#if columnsVisible.minPods}
                <Table.TableCell>{row.minPods}</Table.TableCell>
              {/if}
              {#if columnsVisible.maxPods}
                <Table.TableCell>{row.maxPods}</Table.TableCell>
              {/if}
              {#if columnsVisible.replicas}
                <Table.TableCell>{row.replicas}</Table.TableCell>
              {/if}
              {#if columnsVisible.bindings}
                <Table.TableCell class="truncate">{row.bindings}</Table.TableCell>
              {/if}
              {#if columnsVisible.resource}
                <Table.TableCell class="truncate">{row.resource}</Table.TableCell>
              {/if}
              {#if columnsVisible.group}
                <Table.TableCell class="truncate">{row.group}</Table.TableCell>
              {/if}
              {#if columnsVisible.version}
                <Table.TableCell>{row.version}</Table.TableCell>
              {/if}
              {#if columnsVisible.scope}
                <Table.TableCell>{row.scope}</Table.TableCell>
              {/if}
              {#if columnsVisible.kind}
                <Table.TableCell>{row.kind}</Table.TableCell>
              {/if}
              {#if columnsVisible.controller}
                <Table.TableCell class="truncate">{row.controller}</Table.TableCell>
              {/if}
              {#if columnsVisible.apiGroup}
                <Table.TableCell class="truncate">{row.apiGroup}</Table.TableCell>
              {/if}
              {#if columnsVisible.externalIP}
                <Table.TableCell class="truncate">{row.externalIP}</Table.TableCell>
              {/if}
              {#if columnsVisible.selector}
                <Table.TableCell class="truncate">{row.selector}</Table.TableCell>
              {/if}
              {#if columnsVisible.endpoints}
                <Table.TableCell>{row.endpoints}</Table.TableCell>
              {/if}
              {#if columnsVisible.loadBalancers}
                <Table.TableCell class="truncate">{row.loadBalancers}</Table.TableCell>
              {/if}
              {#if columnsVisible.policyTypes}
                <Table.TableCell>{row.policyTypes}</Table.TableCell>
              {/if}
              {#if columnsVisible.storageClass}
                <Table.TableCell class="truncate">{row.storageClass}</Table.TableCell>
              {/if}
              {#if columnsVisible.size}
                <Table.TableCell>{row.size}</Table.TableCell>
              {/if}
              {#if columnsVisible.pods}
                <Table.TableCell>{row.pods}</Table.TableCell>
              {/if}
              {#if columnsVisible.capacity}
                <Table.TableCell>{row.capacity}</Table.TableCell>
              {/if}
              {#if columnsVisible.serviceType}
                <Table.TableCell class="truncate">{row.serviceType}</Table.TableCell>
              {/if}
              {#if columnsVisible.clusterIP}
                <Table.TableCell class="truncate">{row.clusterIP}</Table.TableCell>
              {/if}
              {#if columnsVisible.ports}
                <Table.TableCell>{row.ports}</Table.TableCell>
              {/if}
              {#if columnsVisible.phase}
                <Table.TableCell>{row.phase}</Table.TableCell>
              {/if}
              {#if columnsVisible.storage}
                <Table.TableCell>{row.storage}</Table.TableCell>
              {/if}
              {#if columnsVisible.claim}
                <Table.TableCell class="truncate">{row.claim}</Table.TableCell>
              {/if}
              {#if columnsVisible.provisioner}
                <Table.TableCell class="truncate">{row.provisioner}</Table.TableCell>
              {/if}
              {#if columnsVisible.reclaimPolicy}
                <Table.TableCell>{row.reclaimPolicy}</Table.TableCell>
              {/if}
              {#if columnsVisible.isDefaultStorageClass}
                <Table.TableCell>{row.isDefaultStorageClass ? "Yes" : "No"}</Table.TableCell>
              {/if}
              {#if columnsVisible.resourceVersion}
                <Table.TableCell class="font-mono text-xs">{row.resourceVersion}</Table.TableCell>
              {/if}
              {#if columnsVisible.value}
                <Table.TableCell>{row.value}</Table.TableCell>
              {/if}
              {#if columnsVisible.globalDefault}
                <Table.TableCell>{row.globalDefault ? "Yes" : "No"}</Table.TableCell>
              {/if}
            </Table.TableRow>
          {/each}
          {#if shouldVirtualizeFlatRows && flatVirtualWindow.paddingBottom > 0}
            <Table.TableRow aria-hidden="true">
              <Table.TableCell
                colspan={2 + visibleDataColumnCount}
                style={`height: ${flatVirtualWindow.paddingBottom}px; padding: 0; border: 0;`}
              ></Table.TableCell>
            </Table.TableRow>
          {/if}
        {:else}
          {#each groupedRows as [group] (`namespace:${group}`)}
            <Table.TableRow class="bg-muted/40">
              <Table.TableCell
                colspan={2 + visibleDataColumnCount}
                class="sticky-table-group-header"
              >
                <div class="inline-flex items-center gap-2">
                  <ConfigurationSelectionCheckbox
                    checked={getGroupSelectionState(getNamespaceRows(group)).checked}
                    indeterminate={getGroupSelectionState(getNamespaceRows(group)).indeterminate}
                    label={`Select namespace ${group}`}
                    onToggle={(next) => toggleGroupSelection(next, getNamespaceRows(group))}
                  />
                  <button
                    type="button"
                    class="inline-flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted"
                    onclick={() => toggleGroup(group)}
                    aria-label={isGroupCollapsed(group) ? "Expand group" : "Collapse group"}
                    title={isGroupCollapsed(group) ? "Expand group" : "Collapse group"}
                  >
                    <TableChevronDown
                      class={`h-4 w-4 transition-transform ${isGroupCollapsed(group) ? "-rotate-90" : "rotate-0"}`}
                    />
                    <span>Namespace: {group}</span>
                    <span class="opacity-80">({getNamespaceRows(group).length})</span>
                  </button>
                </div>
              </Table.TableCell>
            </Table.TableRow>
            {#if !isGroupCollapsed(group)}
              {#each getNamespaceRows(group) as row (row.uid)}
                <Table.TableRow
                  data-state={selectedRowIds.has(row.uid) ? "selected" : undefined}
                  onclick={() => showDetails(row)}
                  class="cursor-pointer"
                >
                  <Table.TableCell>
                    <ConfigurationSelectionCheckbox
                      checked={selectedRowIds.has(row.uid)}
                      label={`Select ${row.namespace}/${row.name}`}
                      onToggle={(checked) => toggleRow(row.uid, checked)}
                    />
                  </Table.TableCell>
                  <Table.TableCell class="w-12" onclick={(event) => event.stopPropagation()}>
                    <ConfigurationActionsMenu
                      name={row.name}
                      namespace={row.namespace}
                      disabled={actionInFlight}
                      isBusy={actionInFlight}
                      onShowDetails={() => showDetails(row)}
                      onEditYaml={() => void openYamlEditor(row)}
                      onCopyKubectlGetYaml={() =>
                        void copyTextToClipboard(
                          buildGetYamlCommand(row),
                          `Copied command for ${row.namespace}/${row.name}`,
                        )}
                      onCopyKubectlDescribe={() =>
                        void copyTextToClipboard(
                          buildDescribeCommand(row),
                          `Copied describe command for ${row.namespace}/${row.name}`,
                        )}
                      onRunDebugDescribe={() => openDebugDescribeForRow(row)}
                      onPortForward={workloadKey === "services"
                        ? () => void openServicePortForward(row)
                        : undefined}
                      onDelete={() => void deleteRows([row])}
                    />
                  </Table.TableCell>
                  {#if columnsVisible.name}
                    <Table.TableCell class="truncate">
                      <div class="flex items-center gap-2">
                        <span class="truncate">{row.name}</span>
                        {#if isRbacWorkload() && row.rbacRiskScore > 0}
                          <span
                            class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              getRbacRiskSeverity(row.rbacRiskScore) === "Critical"
                                ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-400"
                                : getRbacRiskSeverity(row.rbacRiskScore) === "High"
                                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400"
                                  : "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-400"
                            }`}
                            title={`${getRbacRiskSeverity(row.rbacRiskScore)} risk (score ${row.rbacRiskScore}): ${getRbacRiskFindings(
                              row,
                            )
                              .map((f) => f.description)
                              .join("; ")}`}
                          >
                            {getRbacRiskSeverity(row.rbacRiskScore)}
                            {row.rbacRiskScore}
                          </span>
                        {/if}
                        {#if row.driftDetected}
                          <span
                            class="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                          >
                            Drift
                          </span>
                        {/if}
                      </div>
                    </Table.TableCell>
                  {/if}
                  {#if columnsVisible.namespace}
                    <Table.TableCell class="truncate">{row.namespace}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.createdAt}
                    <Table.TableCell>{row.age}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.keys}
                    <Table.TableCell>{row.keys}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.labels}
                    <Table.TableCell class="truncate">{row.labels}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.type}
                    <Table.TableCell class="truncate">{row.type}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.handler}
                    <Table.TableCell class="truncate">{row.handler}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.holder}
                    <Table.TableCell class="truncate">{row.holder}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.webhooks}
                    <Table.TableCell>{row.webhooks}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.status}
                    <Table.TableCell>{row.status}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.minAvailable}
                    <Table.TableCell>{row.minAvailable}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.maxUnavailable}
                    <Table.TableCell>{row.maxUnavailable}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.currentHealthy}
                    <Table.TableCell>{row.currentHealthy}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.desiredHealthy}
                    <Table.TableCell>{row.desiredHealthy}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.metrics}
                    <Table.TableCell>{row.metrics}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.minPods}
                    <Table.TableCell>{row.minPods}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.maxPods}
                    <Table.TableCell>{row.maxPods}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.replicas}
                    <Table.TableCell>{row.replicas}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.bindings}
                    <Table.TableCell class="truncate">{row.bindings}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.resource}
                    <Table.TableCell class="truncate">{row.resource}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.group}
                    <Table.TableCell class="truncate">{row.group}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.version}
                    <Table.TableCell>{row.version}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.scope}
                    <Table.TableCell>{row.scope}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.kind}
                    <Table.TableCell>{row.kind}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.controller}
                    <Table.TableCell class="truncate">{row.controller}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.apiGroup}
                    <Table.TableCell class="truncate">{row.apiGroup}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.externalIP}
                    <Table.TableCell class="truncate">{row.externalIP}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.selector}
                    <Table.TableCell class="truncate">{row.selector}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.endpoints}
                    <Table.TableCell>{row.endpoints}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.loadBalancers}
                    <Table.TableCell class="truncate">{row.loadBalancers}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.policyTypes}
                    <Table.TableCell>{row.policyTypes}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.storageClass}
                    <Table.TableCell class="truncate">{row.storageClass}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.size}
                    <Table.TableCell>{row.size}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.pods}
                    <Table.TableCell>{row.pods}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.capacity}
                    <Table.TableCell>{row.capacity}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.serviceType}
                    <Table.TableCell class="truncate">{row.serviceType}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.clusterIP}
                    <Table.TableCell class="truncate">{row.clusterIP}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.ports}
                    <Table.TableCell>{row.ports}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.phase}
                    <Table.TableCell>{row.phase}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.storage}
                    <Table.TableCell>{row.storage}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.claim}
                    <Table.TableCell class="truncate">{row.claim}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.provisioner}
                    <Table.TableCell class="truncate">{row.provisioner}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.reclaimPolicy}
                    <Table.TableCell>{row.reclaimPolicy}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.isDefaultStorageClass}
                    <Table.TableCell>{row.isDefaultStorageClass ? "Yes" : "No"}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.resourceVersion}
                    <Table.TableCell class="font-mono text-xs"
                      >{row.resourceVersion}</Table.TableCell
                    >
                  {/if}
                  {#if columnsVisible.value}
                    <Table.TableCell>{row.value}</Table.TableCell>
                  {/if}
                  {#if columnsVisible.globalDefault}
                    <Table.TableCell>{row.globalDefault ? "Yes" : "No"}</Table.TableCell>
                  {/if}
                </Table.TableRow>
              {/each}
            {/if}
          {/each}
        {/if}
      </Table.TableBody>
    </Table.Table>
  </TableSurface>

  <TablePagination
    currentPage={configPageIndex}
    totalPages={configTotalPages}
    totalRows={filteredRows.length}
    pageSize={configPageSize}
    onPageChange={(p) => {
      configPageIndex = p;
      tableScrollTop = 0;
    }}
    onPageSizeChange={(s) => {
      configPageSize = s;
      configPageIndex = 0;
      tableScrollTop = 0;
    }}
  />

  {#if detailsOpen && selectedDetail}
    {@const detailRow = selectedDetail}
    <DetailsSheetPortal
      open={detailsOpen}
      onClose={() => {
        detailsOpen = false;
      }}
      closeAriaLabel={`Close ${getDetailsResourceLabel()} details`}
    >
      <div class="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div class="min-w-0 flex items-center gap-2">
          <Info class="h-4 w-4 shrink-0 text-muted-foreground" />
          <div class="truncate text-base font-semibold">
            {getDetailsResourceLabel()}: {detailRow.name}
          </div>
        </div>
        <DetailsHeaderActions
          actions={[
            {
              id: "copy-get-yaml",
              title: "Copy kubectl get -o yaml",
              ariaLabel: "Copy kubectl get yaml",
              icon: Copy,
              onClick: () =>
                void copyTextToClipboard(
                  buildGetYamlCommand(detailRow),
                  `Copied command for ${detailRow.namespace}/${detailRow.name}`,
                ),
            },
            {
              id: "copy-describe",
              title: "Copy kubectl describe",
              ariaLabel: "Copy kubectl describe",
              icon: ClipboardList,
              onClick: () =>
                void copyTextToClipboard(
                  buildDescribeCommand(detailRow),
                  `Copied describe command for ${detailRow.namespace}/${detailRow.name}`,
                ),
            },
            {
              id: "debug-describe",
              title: "Run debug describe",
              ariaLabel: "Run debug describe",
              icon: Bug,
              onClick: () => openDebugDescribeForRow(detailRow),
            },
            {
              id: "edit-yaml",
              title: "Edit YAML",
              ariaLabel: `Edit ${getDetailsResourceLabel()} YAML`,
              icon: Pencil,
              onClick: () => {
                detailsOpen = false;
                void tick().then(() => openYamlEditor(detailRow));
              },
            },
            ...(workloadKey === "services"
              ? [
                  {
                    id: "port-forward-web",
                    title: "Port-forward preview",
                    ariaLabel: "Port-forward preview",
                    icon: Link2,
                    onClick: () => {
                      detailsOpen = false;
                      void openServicePortForward(detailRow);
                    },
                  },
                ]
              : []),
            {
              id: "delete",
              title: "Delete",
              ariaLabel: `Delete ${getDetailsResourceLabel()}`,
              icon: Trash,
              destructive: true,
              onClick: () => {
                detailsOpen = false;
                void deleteRows([detailRow]);
              },
            },
          ]}
          closeAriaLabel={`Close ${getDetailsResourceLabel()} details`}
          closeTitle="Close"
          onClose={() => {
            detailsOpen = false;
          }}
        />
      </div>
      <div class="flex-1 overflow-y-auto p-4 text-sm">
        <h3 class="mb-2 font-bold">Properties</h3>
        <DetailsMetadataGrid
          contextKey={`${detailRow.namespace}/${detailRow.name}`}
          fields={[
            { label: "Created", value: formatCreatedWithAge(detailRow.createdAt) },
            { label: "Name", value: detailRow.name },
            ...(isNamespaceScoped ? [{ label: "Namespace", value: detailRow.namespace }] : []),
            ...(workloadKey === "ingressclasses"
              ? [{ label: "Namespace", value: detailRow.namespace }]
              : []),
            ...(workloadKey === "configmaps"
              ? [{ label: "Keys", value: String(detailRow.keys ?? 0) }]
              : []),
            ...(workloadKey === "secrets"
              ? [
                  { label: "Type", value: detailRow.type || "Opaque" },
                  { label: "Keys", value: String(detailRow.keys ?? 0) },
                ]
              : []),
            ...(workloadKey === "resourcequotas"
              ? [{ label: "Hard limits", value: detailRow.details || "-" }]
              : []),
            ...(workloadKey === "limitranges"
              ? [{ label: "Limits", value: detailRow.details || "-" }]
              : []),
            ...(workloadKey === "horizontalpodautoscalers"
              ? [
                  { label: "Status", value: detailRow.status || "-" },
                  { label: "Metrics", value: detailRow.metrics || "-" },
                  { label: "Min pods", value: String(detailRow.minPods ?? "-") },
                  { label: "Max pods", value: String(detailRow.maxPods ?? "-") },
                  { label: "Replicas", value: String(detailRow.replicas ?? "-") },
                ]
              : []),
            ...(workloadKey === "poddisruptionbudgets"
              ? [
                  { label: "Min available", value: String(detailRow.minAvailable ?? "-") },
                  { label: "Max unavailable", value: String(detailRow.maxUnavailable ?? "-") },
                  { label: "Current healthy", value: String(detailRow.currentHealthy ?? "-") },
                  { label: "Desired healthy", value: String(detailRow.desiredHealthy ?? "-") },
                ]
              : []),
            ...(workloadKey === "runtimeclasses"
              ? [{ label: "Handler", value: detailRow.handler || "-" }]
              : []),
            ...(workloadKey === "leases"
              ? [{ label: "Holder", value: detailRow.holder || "-" }]
              : []),
            ...(workloadKey === "mutatingwebhookconfigurations" ||
            workloadKey === "validatingwebhookconfigurations"
              ? [{ label: "Webhooks", value: String(detailRow.webhooks ?? 0) }]
              : []),
            ...(workloadKey === "serviceaccounts"
              ? [{ label: "Summary", value: detailRow.details || "-" }]
              : []),
            ...(workloadKey === "namespaces"
              ? [{ label: "Status", value: detailRow.status || "Active" }]
              : []),
            ...(workloadKey === "ingressclasses"
              ? [
                  { label: "Controller", value: detailRow.controller || "-" },
                  { label: "ApiGroup", value: detailRow.apiGroup || "-" },
                  { label: "Scope", value: detailRow.scope || "-" },
                  { label: "Kind", value: detailRow.kind || "-" },
                  {
                    label: "Default",
                    value:
                      String(
                        asRecord(asRecord(detailRow.raw.metadata).annotations)[
                          "ingressclass.kubernetes.io/is-default-class"
                        ] ?? "",
                      ).toLowerCase() === "true"
                        ? "Yes"
                        : "No",
                  },
                ]
              : []),
            ...(workloadKey === "gatewayclasses"
              ? [{ label: "Controller", value: detailRow.type || "-" }]
              : []),
            ...(workloadKey === "rolebindings" || workloadKey === "clusterrolebindings"
              ? [{ label: "Bindings", value: detailRow.bindings }]
              : []),
            ...(workloadKey === "services"
              ? [
                  { label: "External IP", value: detailRow.externalIP },
                  { label: "ClusterIP", value: detailRow.clusterIP },
                  { label: "Selector", value: detailRow.selector },
                  { label: "Status", value: detailRow.status },
                  { label: "Ports", value: String(detailRow.ports) },
                ]
              : []),
            ...(workloadKey === "endpoints"
              ? [{ label: "Endpoints", value: detailRow.endpoints }]
              : []),
            ...(workloadKey === "endpointslices"
              ? [
                  { label: "Endpoints", value: detailRow.endpoints },
                  { label: "Ports", value: String(detailRow.ports) },
                  { label: "Status", value: detailRow.status },
                ]
              : []),
            ...(workloadKey === "ingresses"
              ? [
                  { label: "LoadBalancers", value: detailRow.loadBalancers },
                  { label: "Rules", value: String(detailRow.ports) },
                ]
              : []),
            ...(workloadKey === "networkpolicies"
              ? [{ label: "Policy Types", value: detailRow.policyTypes }]
              : []),
            ...(workloadKey === "persistentvolumeclaims"
              ? [
                  { label: "Storage Class", value: detailRow.storageClass },
                  { label: "Size", value: detailRow.size },
                  { label: "Pods", value: detailRow.pods },
                  { label: "Status", value: detailRow.status },
                ]
              : []),
            ...(workloadKey === "persistentvolumes"
              ? [
                  { label: "Storage Class", value: detailRow.storageClass },
                  { label: "Capacity", value: detailRow.capacity },
                  { label: "Claim", value: detailRow.claim },
                  { label: "Status", value: detailRow.status },
                ]
              : []),
            ...(workloadKey === "storageclasses"
              ? [
                  { label: "Provisioner", value: detailRow.provisioner },
                  { label: "Reclaim", value: detailRow.reclaimPolicy },
                  { label: "Default", value: detailRow.isDefaultStorageClass ? "Yes" : "No" },
                ]
              : []),
            ...(workloadKey === "volumeattributesclasses"
              ? [{ label: "Driver", value: detailRow.provisioner }]
              : []),
            ...(workloadKey === "volumesnapshots"
              ? [
                  { label: "Snapshot Class", value: detailRow.storageClass },
                  { label: "Restore Size", value: detailRow.size },
                  { label: "Status", value: detailRow.status },
                ]
              : []),
            ...(workloadKey === "volumesnapshotcontents"
              ? [
                  { label: "Snapshot Ref", value: detailRow.claim },
                  { label: "Driver", value: detailRow.provisioner },
                  { label: "Deletion Policy", value: detailRow.reclaimPolicy },
                  { label: "Restore Size", value: detailRow.size },
                  { label: "Status", value: detailRow.status },
                ]
              : []),
            ...(workloadKey === "volumesnapshotclasses"
              ? [
                  { label: "Driver", value: detailRow.provisioner },
                  { label: "Deletion Policy", value: detailRow.reclaimPolicy },
                  { label: "Default", value: detailRow.isDefaultStorageClass ? "Yes" : "No" },
                ]
              : []),
            ...(workloadKey === "csistoragecapacities"
              ? [
                  { label: "Storage Class", value: detailRow.storageClass },
                  { label: "Capacity", value: detailRow.capacity },
                ]
              : []),
            ...(workloadKey === "priorityclasses"
              ? [
                  { label: "Value", value: detailRow.value },
                  { label: "Global default", value: detailRow.globalDefault ? "Yes" : "No" },
                ]
              : []),
            ...(isRbacWorkload()
              ? [
                  { label: "RBAC risk score", value: String(detailRow.rbacRiskScore) },
                  { label: "RBAC severity", value: getRbacRiskSeverity(detailRow.rbacRiskScore) },
                ]
              : []),
            ...(detailRow.driftDetected
              ? [{ label: "Drift", value: "Detected vs last-applied" }]
              : []),
            ...(workloadKey === "customresourcedefinitions"
              ? [
                  { label: "Resource", value: detailRow.resource },
                  { label: "Group", value: detailRow.group },
                  { label: "Version", value: detailRow.version },
                  { label: "Scope", value: detailRow.scope },
                  { label: "Versions", value: getCrdVersionSummary(detailRow) },
                  { label: "Conversion", value: getCrdConversionSummary(detailRow) },
                  { label: "Conditions", value: getCrdConditionSummary(detailRow) },
                ]
              : []),
          ]}
          labels={getLabelEntries(detailRow)}
          annotations={getAnnotationEntries(detailRow)}
          labelsEmptyText="No labels"
          annotationsEmptyText="No annotations"
        />
        <div class="mt-2 rounded border p-3 text-sm">
          <div class="text-xs text-muted-foreground">Managed Fields</div>
          <button
            type="button"
            class="inline-flex w-fit items-center gap-1 rounded px-1.5 py-1 text-left text-muted-foreground transition hover:bg-muted hover:text-foreground"
            onclick={() => {
              showManagedFieldsDetails = !showManagedFieldsDetails;
            }}
          >
            {#if showManagedFieldsDetails}
              <ChevronUp class="h-4 w-4" />
            {:else}
              <ChevronDown class="h-4 w-4" />
            {/if}
            {getManagedManagerCount(detailRow)} Managers
          </button>
          {#if showManagedFieldsDetails}
            <div class="mt-2 rounded border bg-muted/20 p-2 text-xs">
              {#if getManagedFields(detailRow).length === 0}
                <p class="text-muted-foreground">No managed fields</p>
              {:else}
                {#each getManagedFields(detailRow) as field}
                  <p>
                    <span class="font-medium">{field.manager}</span>
                    <span class="text-muted-foreground"> ({field.operation})</span>
                    {#if field.time}
                      <span class="text-muted-foreground">
                        · {new Date(field.time).toLocaleString()}</span
                      >
                    {/if}
                  </p>
                {/each}
              {/if}
            </div>
          {/if}
        </div>

        {#if getRbacRelationLines(detailRow).length > 0}
          <h3 class="my-4 font-bold">RBAC Relations</h3>
          <div class="rounded border bg-muted/10 p-2 text-xs">
            {#each getRbacRelationLines(detailRow) as line}
              <p class="font-mono">{line}</p>
            {/each}
          </div>
        {/if}

        {#if getRelationGraphLines(detailRow).length > 0}
          <h3 class="my-4 font-bold">Owner / Controller Graph</h3>
          <div class="rounded border bg-muted/10 p-2 text-xs">
            {#each getRelationGraphLines(detailRow) as line}
              <p class="font-mono">{line}</p>
            {/each}
          </div>
        {/if}

        {#if getRbacRiskFindings(detailRow).length > 0}
          <h3 class="my-4 font-bold">Risk Findings</h3>
          <div
            class="space-y-2 rounded border border-slate-300/60 bg-slate-50/40 p-3 text-xs dark:border-slate-600/40 dark:bg-slate-900/40"
          >
            <div class="mb-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
              <span class="inline-flex items-center gap-1"
                ><span class="inline-block h-2 w-2 rounded-full bg-rose-500"></span> Critical</span
              >
              <span class="inline-flex items-center gap-1"
                ><span class="inline-block h-2 w-2 rounded-full bg-amber-500"></span> High</span
              >
              <span class="inline-flex items-center gap-1"
                ><span class="inline-block h-2 w-2 rounded-full bg-yellow-500"></span> Medium</span
              >
            </div>
            {#each getRbacRiskFindings(detailRow) as finding}
              <div class="flex items-start gap-2">
                <span
                  class={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${
                    finding.severity === "critical"
                      ? "bg-rose-500"
                      : finding.severity === "high"
                        ? "bg-amber-500"
                        : "bg-yellow-500"
                  }`}
                ></span>
                <span
                  class={`font-mono ${
                    finding.severity === "critical"
                      ? "text-rose-700 dark:text-rose-400"
                      : finding.severity === "high"
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-yellow-700 dark:text-yellow-400"
                  }`}>{finding.description}</span
                >
              </div>
            {/each}
          </div>
        {/if}

        {#if getStorageDebugHints(detailRow).length > 0}
          <h3 class="my-4 font-bold">Storage Debug Hints</h3>
          <div
            class="space-y-1.5 rounded border border-amber-300/60 bg-amber-50/40 p-3 text-xs dark:border-amber-500/30 dark:bg-amber-950/30"
          >
            {#each getStorageDebugHints(detailRow) as hint}
              <p class="font-mono text-amber-700 dark:text-amber-300">{hint}</p>
            {/each}
          </div>
        {/if}

        {#if workloadKey === "persistentvolumeclaims"}
          <PvcUsageBar
            clusterId={data.slug}
            pvcName={detailRow.name}
            pvcNamespace={detailRow.namespace}
          />
        {/if}

        {#if ["ingresses", "services", "endpoints", "gateways", "httproutes", "persistentvolumeclaims", "persistentvolumes", "storageclasses", "configmaps", "secrets", "namespaces", "serviceaccounts"].includes(workloadKey)}
          <ResourceTrafficChain
            clusterId={data.slug}
            resourceKind={singularLabelByWorkload[workloadKey] ?? workloadKey}
            resourceName={detailRow.name}
            resourceNamespace={detailRow.namespace}
            raw={detailRow.raw}
          />
        {/if}

        {#if getNetworkDebugBundle(detailRow)}
          <h3 class="my-4 font-bold">Network Debug Bundle</h3>
          <div class="rounded border bg-muted/10 p-2 text-xs">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onclick={() =>
                void copyTextToClipboard(
                  getNetworkDebugBundle(detailRow),
                  "Copied network debug commands.",
                )}
            >
              Copy debug bundle
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onclick={() =>
                void exportDebugBundle(
                  getNetworkDebugBundle(detailRow),
                  [clusterId || "cluster", "network-debug", detailRow.namespace, detailRow.name],
                  "Exported network debug bundle.",
                )}
            >
              Export debug bundle
            </Button>
            <pre class="mt-2 whitespace-pre-wrap break-all">{getNetworkDebugBundle(detailRow)}</pre>
          </div>
        {/if}

        {#if workloadKey === "configmaps" || workloadKey === "secrets"}
          <h3 class="my-4 font-bold">Data</h3>
          {#if getDataEntries(detailRow).length === 0}
            <p class="text-sm text-muted-foreground">No data keys found</p>
          {:else}
            <div class="space-y-3">
              <div class="flex items-center gap-2">
                <Input
                  class="flex-1"
                  placeholder="Search data keys..."
                  bind:value={dataDetailsSearch}
                />
                {#if workloadKey === "secrets"}
                  <button
                    type="button"
                    class="inline-flex items-center gap-1.5 rounded border px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground whitespace-nowrap"
                    onclick={() => cycleSecretGlobalState()}
                    title={secretGlobalState === "masked"
                      ? "Show base64 values"
                      : secretGlobalState === "base64"
                        ? "Decode all to plaintext"
                        : "Hide all values"}
                    aria-label="Cycle secret visibility"
                  >
                    {#if secretGlobalState === "masked"}
                      <Eye class="h-3.5 w-3.5" />
                      Show base64
                    {:else if secretGlobalState === "base64"}
                      <KeyRound class="h-3.5 w-3.5" />
                      Decode all
                    {:else}
                      <EyeOff class="h-3.5 w-3.5" />
                      Hide all
                    {/if}
                  </button>
                {/if}
              </div>
              {#if getFilteredDataEntries(detailRow).length === 0}
                <p class="text-xs text-muted-foreground">No keys match your search</p>
              {/if}
              {#each getFilteredDataEntries(detailRow) as [key, value]}
                {@const keyState = workloadKey === "secrets" ? getSecretKeyState(key) : "base64"}
                <div class="rounded border bg-muted/10 p-2">
                  <div class="flex items-center justify-between gap-2">
                    <p class="font-mono text-xs">{key}</p>
                    <div class="flex items-center gap-1">
                      {#if workloadKey === "secrets"}
                        <button
                          type="button"
                          class="rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                          onclick={() => cycleSecretKeyState(key)}
                          title={keyState === "masked"
                            ? "Show base64"
                            : keyState === "base64"
                              ? "Decode to plaintext"
                              : "Hide value"}
                          aria-label={`Toggle visibility for ${key}`}
                        >
                          {#if keyState === "masked"}
                            <Eye class="h-3.5 w-3.5" />
                          {:else if keyState === "base64"}
                            <KeyRound class="h-3.5 w-3.5" />
                          {:else}
                            <EyeOff class="h-3.5 w-3.5" />
                          {/if}
                        </button>
                      {/if}
                      {#if keyState !== "masked"}
                        <button
                          type="button"
                          class="rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                          onclick={() => {
                            const copyValue =
                              keyState === "decoded" ? decodeBase64(value) : String(value ?? "");
                            void copyTextToClipboard(
                              copyValue,
                              `Copied ${keyState === "decoded" ? "decoded" : "base64"}: ${key}`,
                            );
                          }}
                          title={keyState === "decoded"
                            ? "Copy decoded value"
                            : "Copy base64 value"}
                          aria-label={`Copy value for ${key}`}
                        >
                          <Copy class="h-3.5 w-3.5" />
                        </button>
                      {/if}
                    </div>
                  </div>
                  <p class="text-xs text-muted-foreground">{getDataEntrySize(value)}</p>
                  {#if workloadKey === "secrets" && keyState === "masked"}
                    <pre
                      class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-500">{"*".repeat(
                        Math.min(String(value ?? "").length, 32),
                      )}</pre>
                  {:else if workloadKey === "secrets" && keyState === "decoded"}
                    <pre
                      class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs text-emerald-400">{decodeBase64(
                        value,
                      )}</pre>
                  {:else}
                    <pre
                      class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs">{String(
                        value ?? "",
                      )}</pre>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        {/if}

        <h3 class="my-4 font-bold">Events</h3>
        <DetailsEventsList
          events={detailsEvents}
          loading={detailsEventsLoading}
          error={detailsEventsError}
          emptyText="No events found"
        />
      </div>
    </DetailsSheetPortal>
  {/if}
</div>
