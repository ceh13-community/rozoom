<script lang="ts">
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { dev } from "$app/environment";
  import { goto } from "$app/navigation";
  import { Trash } from "$shared/ui/icons";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import {
    loadKubeconfig,
    kubeConfigFile,
    kubeConfigError,
    clearKubeConfigMessages,
    kubeConfigSuccess,
    isKubeConfigLoading,
  } from "$features/cluster-finder";
  import {
    detectedClis,
    detectedOsTools,
    detectedCloudConfigs,
    isCliDetectionLoading,
    loadDetectedClis,
  } from "$features/cluster-finder/model/cli-store";
  import {
    clustersList,
    isClustersConfigLoading,
    clustersConfigError,
    clustersConfigSuccess,
    loadClusters,
    addClustersFromKubeconfig,
    addClustersFromKubeconfigSelection,
    addClustersFromText,
    removeCluster,
    removedClustersList,
    restoreCluster,
    purgeCluster,
    updateClusterMeta,
    renameClusterContext,
    toggleClusterState,
    toggleClusterPin,
    clearClustersConfigMessages,
  } from "$features/cluster-manager";
  import {
    detectClusterProvider,
    getProviderCategory,
    type ClusterProvider,
    type ClusterProviderCategory,
  } from "$shared/lib/provider-detection";
  import { compareClustersByEnv } from "$shared/lib/env-sort-priority";
  import { Button } from "$shared/ui/button";
  import { Textarea } from "$shared/ui/textarea";
  import { ErrorMessage } from "$shared/ui/error-message";
  import { SuccessMessage } from "$shared/ui/success-message";
  import { LoadingSpinner } from "$shared/ui/loading-spinner";
  import { buildManagedSelection } from "../lib/selection";
  import Input from "$shared/ui/input/input.svelte";
  import * as Select from "$shared/ui/select";
  import { Checkbox } from "$shared/ui/checkbox";
  import { Label } from "$shared/ui/label";
  import {
    safeDebugLog,
    safeDialogAsk,
    safeDialogOpen,
    safeReadTextFile,
  } from "$shared/lib/tauri-runtime";
  import {
    probeClusterConnection,
    type ConnectionProbeResult,
  } from "$features/cluster-manager/api/probe-connection";
  import {
    listCloudClusters,
    importCloudCluster,
    getSupportedCloudProviders,
    type CloudCluster,
  } from "$features/cluster-manager/api/cloud-import";
  import { recordAudit } from "$features/cluster-manager/model/audit-trail";
  import {
    detectAuthMethod,
    type AuthMethodInfo,
  } from "$features/cluster-manager/model/auth-detection";
  import ConnectClusterWizard from "./connect-cluster-wizard.svelte";

  type DetectedCluster = {
    name: string;
    source: string;
    contextName: string | null;
    displayName: string;
    provider: string;
    providerCategory: ClusterProviderCategory;
    region: string | null;
    authMethod: string;
    status: "ready" | "auth-issue" | "unreachable";
    statusLabel: string;
    env: string;
    tags: string[];
    warnings: string[];
    importWarnings: string[];
    authInfo: AuthMethodInfo;
    alreadyAdded: boolean;
  };

  const managedStatusFilterOptions = [
    { value: "all", label: "All statuses" },
    { value: "online", label: "Online only" },
    { value: "offline", label: "Offline only" },
  ];
  const staticEnvOptions = [
    { value: "shared", label: "shared" },
    { value: "stage", label: "stage" },
    { value: "dev", label: "dev" },
    { value: "prod", label: "prod" },
  ];
  const managedEnvOptions = [{ value: "", label: "Auto" }, ...staticEnvOptions];

  let rawConfigData = $state("");
  let showPageInfo = $state(false);
  let isLoading = $derived($isClustersConfigLoading || $isKubeConfigLoading);
  let clustersCount = $derived($clustersList.length);

  // Track when the user last triggered a Cloud Providers rescan. On
  // first launch the Cloud Providers panel shows a CTA button; once
  // the user clicks it (or clicks Refresh inside the panel), the CTA
  // is replaced by a compact "Last scanned Nm ago | Refresh" strip in
  // the panel summary. Persisted across sessions so the CTA doesn't
  // reappear on reload.
  const PROVIDERS_SCAN_STORAGE_KEY = "cluster-manager:providers-last-scan-at";
  let providersScanAt = $state<number | null>(null);
  let nowTick = $state(Date.now());

  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(PROVIDERS_SCAN_STORAGE_KEY);
    const parsed = stored ? Number(stored) : null;
    if (parsed && Number.isFinite(parsed)) {
      providersScanAt = parsed;
    }
  }

  $effect(() => {
    const id = setInterval(() => (nowTick = Date.now()), 30_000);
    return () => clearInterval(id);
  });

  const providersScanLabel = $derived.by(() => {
    void nowTick;
    if (!providersScanAt) return "never";
    const deltaSec = Math.max(0, Math.round((Date.now() - providersScanAt) / 1000));
    if (deltaSec < 45) return "just now";
    if (deltaSec < 90) return "1m ago";
    const mins = Math.round(deltaSec / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
  });
  let hasAvailableConfigs = $derived($kubeConfigFile && $kubeConfigFile.clusters?.length > 0);
  let errors: string = $state("");
  let selectedDetectedClusters = $state<Record<string, boolean>>({});
  let selectedManagedClusters = $state<Record<string, boolean>>({});
  let displayNameOverrides = $state<Record<string, string>>({});
  let envOverrides = $state<Record<string, string>>({});
  let activeCluster = $state<DetectedCluster | null>(null);
  let managedStatusFilter = $state(managedStatusFilterOptions[0].value);
  let managedProviderFilter = $state("all");
  let managedEnvFilter = $state("all");
  let managedSearch = $state("");
  let probeResults = $state<Record<string, ConnectionProbeResult>>({});
  let isProbing = $state(false);

  // Cloud import state
  let cloudClusters = $state<CloudCluster[]>([]);
  let cloudImportProvider = $state<string | null>(null);
  let cloudListLoading = $state(false);
  let cloudImportLoading = $state(false);
  let cloudImportError = $state<string | null>(null);
  let cloudImportSuccess = $state<string | null>(null);

  async function listClouds(provider: string) {
    cloudImportProvider = provider;
    cloudListLoading = true;
    cloudImportError = null;
    cloudClusters = [];
    const result = await listCloudClusters(provider);
    cloudListLoading = false;
    if (result.error) {
      cloudImportError = result.error;
      return;
    }
    cloudClusters = result.clusters;
  }

  async function importFromCloud(cluster: CloudCluster) {
    cloudImportLoading = true;
    cloudImportError = null;
    cloudImportSuccess = null;
    const result = await importCloudCluster(cluster);
    cloudImportLoading = false;
    if (!result.success) {
      cloudImportError = result.error ?? "Import failed";
      return;
    }
    if (result.kubeconfigYaml) {
      await addClustersFromText(result.kubeconfigYaml);
      cloudImportSuccess = `Imported "${cluster.name}" from ${cluster.provider}`;
      cloudClusters = cloudClusters.filter((c) => c.name !== cluster.name);
    }
  }

  function closeCloudImport() {
    cloudImportProvider = null;
    cloudClusters = [];
    cloudImportError = null;
    cloudImportSuccess = null;
  }

  onMount(async () => {
    await loadData();
    await safeDebugLog(`[Hooks on client]. Is dev? ${dev}`);
  });

  async function loadData() {
    await Promise.all([loadClusters(), loadKubeconfig()]);
    // Only auto-refresh provider detection if the user has opted in
    // via a prior Scan click; otherwise the onboarding CTA never gets
    // seen because the panel is already populated by background work.
    if (providersScanAt !== null) {
      void loadDetectedClis();
    }
    void probeDetectedClusters();
  }

  // User-initiated rescan of the Cloud Providers panel. onMount still
  // calls loadData silently so the rest of the page (kubeconfig,
  // managed clusters) is populated; this function stamps the
  // providers scan timestamp so the CTA flips to the compact strip
  // only after the user has actively interacted with the panel.
  let providersRefreshing = $state(false);
  async function handleProvidersRefresh() {
    providersRefreshing = true;
    try {
      await loadDetectedClis();
    } finally {
      providersRefreshing = false;
    }
    providersScanAt = Date.now();
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(PROVIDERS_SCAN_STORAGE_KEY, String(providersScanAt));
      } catch {
        // best-effort: localStorage may be full or disabled
      }
    }
  }

  async function probeDetectedClusters() {
    const config = $kubeConfigFile;
    if (!config?.path || !config.clusters?.length) return;

    isProbing = true;
    const contextsByCluster = new Map<string, string>();
    config.contexts?.forEach((ctx) => {
      contextsByCluster.set(ctx.context.cluster, ctx.name);
    });

    const probes = config.clusters.map(async (cluster) => {
      const contextName = contextsByCluster.get(cluster.name);
      if (!contextName) return;
      try {
        const result = await probeClusterConnection(contextName, config.path);
        probeResults = { ...probeResults, [cluster.name]: result };
      } catch {
        probeResults = { ...probeResults, [cluster.name]: { status: "unreachable", latencyMs: 0 } };
      }
    });

    await Promise.allSettled(probes);
    isProbing = false;
  }

  async function handleAddFromAvailableConfigs() {
    if (!$kubeConfigFile?.clusters) return;

    await addClustersFromKubeconfig($kubeConfigFile, $kubeConfigFile.path);
  }

  async function handleAddSelectedClusters() {
    if (!$kubeConfigFile?.clusters) return;

    const selections = detectedClusters
      .filter((cluster) => selectedDetectedClusters[cluster.name])
      .filter((cluster) => !cluster.alreadyAdded)
      .map((cluster) => ({
        name: cluster.name,
        displayName: cluster.displayName.trim() || cluster.name,
        env: cluster.env,
        provider: cluster.provider,
        source: cluster.source,
        tags: cluster.tags,
      }));

    if (selections.length === 0) {
      errors = "Select at least one new cluster to add.";
      return;
    }

    errors = "";
    await addClustersFromKubeconfigSelection($kubeConfigFile, $kubeConfigFile.path, selections);
  }

  async function handleAddAllDetected() {
    if (!$kubeConfigFile?.clusters) return;

    const selections = detectedClusters
      .filter((cluster) => !cluster.alreadyAdded)
      .map((cluster) => ({
        name: cluster.name,
        displayName: cluster.displayName.trim() || cluster.name,
        env: cluster.env,
        provider: cluster.provider,
        source: cluster.source,
        tags: cluster.tags,
      }));

    if (selections.length === 0) {
      errors = "All detected clusters are already managed.";
      return;
    }

    errors = "";
    await addClustersFromKubeconfigSelection($kubeConfigFile, $kubeConfigFile.path, selections);
  }

  async function handleAddSingleCluster(cluster: DetectedCluster) {
    if (!$kubeConfigFile?.clusters) return;

    if (cluster.alreadyAdded) {
      errors = "This cluster is already managed.";
      return;
    }

    errors = "";
    await addClustersFromKubeconfigSelection($kubeConfigFile, $kubeConfigFile.path, [
      {
        name: cluster.name,
        displayName: cluster.displayName.trim() || cluster.name,
        env: cluster.env,
        provider: cluster.provider,
        source: cluster.source,
        tags: cluster.tags,
      },
    ]);
  }

  async function handleUploadConfigFile() {
    const file = await safeDialogOpen({
      filters: [
        { name: "YAML", extensions: ["yaml", "yml"] },
        { name: "Config", extensions: ["config", "conf"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (!file || Array.isArray(file)) return;

    const content = await safeReadTextFile(file);

    const result = await addClustersFromText(content);
  }

  async function handleImportFromText() {
    if (!rawConfigData.trim()) return;

    await addClustersFromText(rawConfigData);

    if ($clustersList.length > 0) {
      rawConfigData = "";
    }
  }

  async function handleToggleConnection(uuid: string) {
    if (!uuid) return;

    await toggleClusterState(uuid);
  }

  async function handleTogglePin(uuid: string) {
    if (!uuid) return;

    await toggleClusterPin(uuid);
  }

  async function handleRemoveCluster(uuid: string, clusterName: string) {
    const confirmed = await safeDialogAsk(`Remove cluster "${clusterName}" from list?`, {
      title: "Confirm Removal",
      kind: "warning",
    });

    if (confirmed) {
      await removeCluster(uuid);
      void recordAudit("cluster-removed", { clusterName, clusterUuid: uuid });
    }
  }

  async function handleRemoveSelectedClusters() {
    const selected = Object.entries(selectedManagedClusters)
      .filter(([, checked]) => checked)
      .map(([uuid]) => uuid);

    if (!selected.length) return;

    const confirmed = await safeDialogAsk(
      `Remove ${selected.length} selected cluster${selected.length > 1 ? "s" : ""}?`,
      {
        title: "Confirm Bulk Removal",
        kind: "warning",
      },
    );

    if (!confirmed) return;

    for (const uuid of selected) {
      await removeCluster(uuid);
    }

    selectedManagedClusters = {};
  }

  async function openDashboard() {
    goto("/dashboard");
  }

  const scanningPaths = [
    "~/.kube/config",
    "~/.kube/*.yaml|yml",
    "$KUBECONFIG (split by :)",
    "~/.config/kube/*",
    "./kubeconfig",
    "./.kube/config",
  ];

  const detectedClusters = $derived.by<DetectedCluster[]>(() => {
    const source = $kubeConfigFile?.path ?? "Unknown source";
    const managedNames = new Set($clustersList.map((cluster) => cluster.name));
    const contextsByCluster = new Map<string, string>();

    $kubeConfigFile?.contexts?.forEach((context) => {
      contextsByCluster.set(context.context.cluster, context.name);
    });

    return (
      $kubeConfigFile?.clusters?.map((cluster) => {
        const contextName = contextsByCluster.get(cluster.name) ?? null;
        const context = $kubeConfigFile?.contexts?.find((c) => c.context.cluster === cluster.name);
        const user = context
          ? $kubeConfigFile?.users?.find((u) => u.name === context.context.user)
          : null;

        const detection = detectClusterProvider({
          clusterName: cluster.name,
          contextName,
          serverUrl: cluster.server ?? null,
          execCommand: user?.execCommand ?? null,
          execArgs: user?.execArgs ?? null,
          authProvider: user?.authProvider ?? null,
        });

        const provider = detection.provider;
        const region = detection.region;
        const authMethod = detection.authMethod;
        const providerCategory = detection.category;
        const status = inferStatus(cluster.name, contextName);
        const env = envOverrides[cluster.name] || inferEnv(cluster.name);
        const displayName = displayNameOverrides[cluster.name] || cluster.name;
        const warnings = inferWarnings(cluster.name, cluster.insecureSkipTlsVerify, user);
        const importWarnings = inferImportWarnings(cluster.name, contextName, provider);
        const tags = buildTags(provider, env, status, warnings);

        const authInfo = detectAuthMethod({
          execCommand: user?.execCommand ?? null,
          authProvider: user?.authProvider ?? null,
          hasToken: user?.hasToken ?? false,
          hasCertAuth: user?.hasCertAuth ?? false,
        });

        return {
          name: cluster.name,
          source,
          contextName,
          displayName,
          provider,
          providerCategory,
          region,
          authMethod,
          authInfo,
          status,
          statusLabel: getStatusLabel(cluster.name, status),
          env,
          tags,
          warnings,
          importWarnings,
          alreadyAdded: managedNames.has(cluster.name),
        };
      }) ?? []
    );
  });

  const detectedSourceGroups = $derived.by(() => {
    if (!detectedClusters.length) return [];

    const source = $kubeConfigFile?.path ?? "Unknown source";
    return [
      {
        source,
        clusters: detectedClusters,
      },
    ];
  });

  const detectedProviderGroups = $derived.by(() => {
    if (!detectedClusters.length) return [];

    const groups = new Map<
      string,
      { provider: string; category: ClusterProviderCategory; clusters: DetectedCluster[] }
    >();
    for (const cluster of detectedClusters) {
      const key = cluster.provider;
      if (!groups.has(key)) {
        groups.set(key, { provider: key, category: cluster.providerCategory, clusters: [] });
      }
      groups.get(key)!.clusters.push(cluster);
    }

    return [...groups.values()].sort((a, b) => {
      if (a.category === "local-runtime" && b.category !== "local-runtime") return 1;
      if (a.category !== "local-runtime" && b.category === "local-runtime") return -1;
      return a.provider.localeCompare(b.provider);
    });
  });

  const selectedDetectedCount = $derived(
    Object.values(selectedDetectedClusters).filter(Boolean).length,
  );

  const detectedSelectionSummary = $derived.by(() =>
    detectedClusters.filter((cluster) => selectedDetectedClusters[cluster.name]),
  );

  const managedProviders = $derived.by(() => {
    const providers = new Set(
      $clustersList
        .map(
          (cluster) =>
            cluster.provider || detectClusterProvider({ clusterName: cluster.name }).provider,
        )
        .filter(Boolean),
    );

    return Array.from(providers).sort();
  });

  const managedProvidersFilterOptions = $derived([
    { value: "all", label: "All providers" },
    ...managedProviders.map((p) => ({ value: p, label: p })),
  ]);

  const managedEnvs = $derived.by(() => {
    const envs = new Set(
      $clustersList.map((cluster) => cluster.env || inferEnv(cluster.name)).filter(Boolean),
    );

    return Array.from(envs).sort();
  });

  const managedEnvFilterOptions = $derived([
    { value: "all", label: "All envs" },
    ...managedEnvs.map((e) => ({ value: e, label: e })),
  ]);

  const managedClustersView = $derived.by(() => {
    const normalizedSearch = managedSearch.trim().toLowerCase();

    return [...$clustersList]
      .map((cluster) => {
        const provider =
          cluster.provider || detectClusterProvider({ clusterName: cluster.name }).provider;
        const env = cluster.env || inferEnv(cluster.name);
        const displayName = cluster.displayName || cluster.name;
        const tags = cluster.tags?.length ? cluster.tags : buildTags(provider, env, null, []);
        const lastSeen = cluster.lastSeenOnline || cluster.addedAt;

        return {
          ...cluster,
          provider,
          env,
          displayName,
          tags,
          lastSeen,
        };
      })
      .filter((cluster) => {
        if (managedStatusFilter === "online" && cluster.offline) return false;
        if (managedStatusFilter === "offline" && !cluster.offline) return false;
        if (managedProviderFilter !== "all" && cluster.provider !== managedProviderFilter) {
          return false;
        }
        if (managedEnvFilter !== "all" && cluster.env !== managedEnvFilter) {
          return false;
        }
        if (normalizedSearch) {
          const haystack =
            `${cluster.displayName} ${cluster.name} ${cluster.tags.join(" ")}`.toLowerCase();
          if (!haystack.includes(normalizedSearch)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return compareClustersByEnv(
          { env: a.env, name: a.displayName, offline: a.offline },
          { env: b.env, name: b.displayName, offline: b.offline },
        );
      });
  });

  const selectedManagedCount = $derived(
    Object.entries(selectedManagedClusters).filter(([key, value]) => key !== "__all" && value)
      .length,
  );

  function getStatusLabel(name: string, status: DetectedCluster["status"]): string {
    const probe = probeResults[name];
    const latency = probe ? ` (${probe.latencyMs}ms)` : "";
    const labels: Record<DetectedCluster["status"], string> = {
      ready: `Ready${latency}`,
      "auth-issue": `Auth issue${latency}`,
      unreachable: `Unreachable${latency}`,
    };
    return labels[status];
  }

  function inferStatus(name: string, contextName: string | null): DetectedCluster["status"] {
    const probe = probeResults[name];
    if (probe) return probe.status;

    const hint = `${name} ${contextName ?? ""}`.toLowerCase();

    if (hint.includes("offline") || hint.includes("down") || hint.includes("unreachable")) {
      return "unreachable";
    }

    if (hint.includes("auth") || hint.includes("forbidden")) {
      return "auth-issue";
    }

    return "ready";
  }

  function inferEnv(name: string): string {
    const hint = name.toLowerCase();

    if (hint.includes("prod")) return "prod";
    if (hint.includes("stage") || hint.includes("staging")) return "stage";
    if (hint.includes("dev")) return "dev";

    return "shared";
  }

  function inferWarnings(
    name: string,
    insecureSkipTls?: boolean,
    user?: { hasToken?: boolean; hasCertAuth?: boolean } | null,
  ): string[] {
    const warnings: string[] = [];
    const hint = name.toLowerCase();

    if (insecureSkipTls || hint.includes("insecure") || hint.includes("skip-tls")) {
      warnings.push("insecure-skip-tls-verify enabled");
    }
    if (user?.hasToken || hint.includes("plaintext")) {
      warnings.push("plaintext token in kubeconfig");
    }
    if (user?.hasCertAuth) {
      warnings.push("embedded client certificate");
    }

    return warnings;
  }

  function inferImportWarnings(
    name: string,
    contextName: string | null,
    provider: string,
  ): string[] {
    const warnings: string[] = [];
    const providerCat = getProviderCategory(provider as ClusterProvider);
    const hint = `${name} ${contextName ?? ""}`.toLowerCase();
    const looksLocal =
      hint.includes("minikube") ||
      hint.includes("docker-desktop") ||
      hint.includes("rancher-desktop") ||
      hint.includes("kind") ||
      hint.includes("colima");

    if (!contextName) {
      warnings.push("No matching kubeconfig context found for this cluster entry.");
    }
    if (providerCat === "managed-cloud" && looksLocal) {
      warnings.push(
        `This looks like a managed cluster, but the name/context hints at a local runtime (${contextName ?? name}).`,
      );
    }
    warnings.push("Import will verify that the selected context resolves back to this cluster.");

    return warnings;
  }

  function buildTags(
    provider: string,
    env: string,
    status: DetectedCluster["status"] | null,
    warnings: string[],
  ): string[] {
    const tags = new Set<string>();

    tags.add(env);
    tags.add(provider.toLowerCase().replace(/\s+/g, "-"));

    if (status === "unreachable") tags.add("offline");
    if (warnings.length) tags.add("warning");

    return Array.from(tags);
  }

  function toSafeId(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9_-]/gi, "-");
  }

  function displayNameOverride(clusterName: string): string {
    return displayNameOverrides[clusterName] ?? "";
  }

  function setDisplayNameOverride(clusterName: string, value: string) {
    displayNameOverrides = {
      ...displayNameOverrides,
      [clusterName]: value,
    };
  }

  function envOverride(clusterName: string): string {
    return envOverrides[clusterName] ?? "";
  }

  function setEnvOverride(clusterName: string, value: string) {
    envOverrides = {
      ...envOverrides,
      [clusterName]: value,
    };
  }

  const triggerShowClusters = $derived(
    managedStatusFilterOptions.find((c) => c.value === managedStatusFilter)?.label ??
      "Select status",
  );

  const triggerShowProviders = $derived(
    managedProvidersFilterOptions.find((c) => c.value === managedProviderFilter)?.label ??
      "Select provider",
  );

  const triggerShowEnvs = $derived(
    managedEnvFilterOptions.find((c) => c.value === managedEnvFilter)?.label ?? "Select env",
  );
</script>

{#if isLoading}
  <main class="flex flex-col min-h-screen">
    <div class="m-auto text-center">
      <LoadingSpinner />
      <p class="text-gray-600">Loading cluster configurations...</p>
    </div>
  </main>
{:else}
  <main class="flex flex-col min-h-screen p-6 bg-slate-50 dark:bg-slate-900">
    <div class="max-w-6xl mx-auto w-full">
      <div class="flex items-center justify-center gap-2 mb-1">
        <h1 class="text-2xl font-semibold tracking-tight text-slate-800 dark:text-slate-100">
          Manage Kubernetes Clusters
        </h1>
        <button
          onclick={() => (showPageInfo = !showPageInfo)}
          class="shrink-0 w-6 h-6 rounded-full bg-amber-400/90 dark:bg-amber-500/80 text-slate-900 dark:text-slate-900 hover:bg-amber-300 dark:hover:bg-amber-400 shadow-sm hover:shadow-md transition-all text-xs font-bold leading-none flex items-center justify-center"
          title="About this page"
        >
          ?
        </button>
      </div>
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-4 text-center">
        Add, verify, and open Kubernetes clusters from your kubeconfig files
      </p>

      {#if showPageInfo}
        <div
          class="mb-5 rounded-xl border border-indigo-200 dark:border-indigo-800/40 bg-indigo-50/50 dark:bg-indigo-950/20 p-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="space-y-2">
              <p class="font-medium text-slate-800 dark:text-slate-100">
                ROZOOM is a self-contained K8s fleet IDE
              </p>
              <p>
                All CLI tools are <strong>bundled inside the app</strong> &mdash; no system installs
                needed. The app discovers your kubeconfig files, detects cloud provider credentials,
                and validates cluster access before adding them to the dashboard.
              </p>
              <ul
                class="list-disc list-inside space-y-0.5 text-xs text-slate-500 dark:text-slate-400"
              >
                <li>
                  <strong>14 Bundled Tools</strong> - kubectl, helm, kustomize, kubeconform, pluto, stern,
                  velero, yq + cloud CLIs (aws, gcloud, doctl, hcloud, oc, az)
                </li>
                <li>
                  <strong>Connect Cluster</strong> - 5 auth methods: OIDC/SSO, Cloud Provider, Vault,
                  X.509 Certificate, Bearer Token
                </li>
                <li>
                  <strong>Cloud Providers</strong> - detected bundled tools, OS tools, and cloud credentials
                </li>
                <li>
                  <strong>Detected kubeconfigs</strong> - auto-scanned contexts with provider, region,
                  auth method, and security level
                </li>
                <li>
                  <strong>Managed Clusters</strong> - per-cluster settings: default namespace, proxy,
                  kubectl version, read-only mode
                </li>
                <li>
                  <strong>Soft-delete</strong> - removed clusters go to trash with restore/purge options
                </li>
                <li>
                  <strong>Catalog Export</strong> - share groups, tags, and display names as JSON (no
                  secrets)
                </li>
                <li>
                  <strong>Audit Trail</strong> - timestamped log of cluster management actions
                </li>
              </ul>
            </div>
            <button
              onclick={() => (showPageInfo = false)}
              class="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg leading-none"
              >&times;</button
            >
          </div>
        </div>
      {/if}
      {#if $clustersConfigError}
        <ErrorMessage error={$clustersConfigError} clearMessages={clearClustersConfigMessages} />
      {/if}

      {#if $kubeConfigError}
        <ErrorMessage error={$kubeConfigError} clearMessages={clearKubeConfigMessages} />
      {/if}

      {#if errors}
        <ErrorMessage error={errors} />
      {/if}

      {#if $kubeConfigSuccess}
        <SuccessMessage success={$kubeConfigSuccess} clearMessages={clearKubeConfigMessages} />
      {/if}

      {#if $clustersConfigSuccess}
        <SuccessMessage
          success={$clustersConfigSuccess}
          clearMessages={clearClustersConfigMessages}
        />
      {/if}

      <!-- Cloud Providers panel -->
      {#if providersScanAt === null && $detectedClis.length === 0 && $detectedCloudConfigs.length === 0}
        <div
          class="mb-6 flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700/60 bg-white/50 dark:bg-slate-800/40 px-5 py-6 text-center"
        >
          <p class="text-sm font-medium text-slate-700 dark:text-slate-200">
            Detect Cloud Providers
          </p>
          <p class="max-w-md text-xs text-slate-500 dark:text-slate-400">
            Scan for bundled / system CLIs (kubectl, helm, aws, gcloud, ...) and cloud credential
            files so the rest of this page can validate cluster access.
          </p>
          <button
            type="button"
            class="mt-1 inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-70"
            onclick={() => void handleProvidersRefresh()}
            disabled={providersRefreshing}
          >
            {#if providersRefreshing}
              Scanning<LoadingDots />
            {:else}
              Scan cloud providers
            {/if}
          </button>
        </div>
      {:else if $detectedClis.length > 0 || $detectedCloudConfigs.length > 0}
        <details
          class="mb-6 group rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-800/60 shadow-sm"
        >
          <summary
            class="flex items-center gap-2.5 cursor-pointer select-none px-5 py-3.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
          >
            <span class="text-[10px] transition-transform group-open:rotate-90">▶</span>
            Cloud Providers
            <span
              class="ml-auto flex items-center gap-3 text-[11px] font-normal text-slate-400 dark:text-slate-500"
            >
              <span>{$detectedClis.filter((c) => c.available).length} bundled</span>
              <span class="w-px h-3 bg-slate-300 dark:bg-slate-600"></span>
              <span>{$detectedOsTools.filter((o) => o.available).length} OS</span>
              <span class="w-px h-3 bg-slate-300 dark:bg-slate-600"></span>
              <span>{$detectedCloudConfigs.length} configs</span>
              {#if providersScanAt !== null}
                <span class="w-px h-3 bg-slate-300 dark:bg-slate-600"></span>
                <span title="Last user-initiated Cloud Providers scan"
                  >Scanned {providersScanLabel}</span
                >
              {/if}
              <span class="w-px h-3 bg-slate-300 dark:bg-slate-600"></span>
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded border border-slate-300 dark:border-slate-600 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300 transition hover:bg-slate-100 dark:hover:bg-slate-700 disabled:cursor-wait disabled:opacity-70"
                onclick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleProvidersRefresh();
                }}
                disabled={providersRefreshing}
                title="Re-scan bundled CLIs, OS-path CLIs, and cloud credential files"
              >
                {#if providersRefreshing}
                  Refreshing<LoadingDots />
                {:else}
                  Refresh
                {/if}
              </button>
            </span>
          </summary>

          <div class="px-5 pb-4 space-y-4">
            <!-- Bundled CLIs -->
            <div>
              <p
                class="text-[10px] font-semibold text-slate-400 dark:text-slate-500 mb-2 uppercase tracking-widest"
              >
                Bundled Tools
              </p>
              <div class="flex flex-wrap gap-1.5">
                {#each $detectedClis as cli (cli.tool)}
                  <div
                    class="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors
                    {cli.available
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                      : cli.planned
                        ? 'border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400/70'
                        : 'border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500'}"
                  >
                    <code class="text-[11px]">{cli.tool}</code>
                    {#if cli.available}
                      <span class="text-emerald-500 dark:text-emerald-400">&#10003;</span>
                    {:else}
                      <span class="text-slate-300 dark:text-slate-600">&times;</span>
                    {/if}
                    {#if cli.planned}
                      <span
                        class="rounded-full bg-amber-100 dark:bg-amber-900/30 px-1.5 py-px text-[9px] font-medium"
                        >planned</span
                      >
                    {/if}
                    {#if cli.version}
                      <span class="text-[10px] font-normal text-slate-400 dark:text-slate-500"
                        >{cli.version}</span
                      >
                    {/if}
                    {#if cli.provider}
                      <span
                        class="rounded bg-indigo-100 dark:bg-indigo-900/30 px-1.5 py-px text-[9px] text-indigo-600 dark:text-indigo-400"
                        >{cli.provider}</span
                      >
                    {/if}
                  </div>
                {/each}
              </div>
            </div>

            <!-- OS Tools (system PATH) -->
            {#if $detectedOsTools.length > 0}
              <div>
                <p
                  class="text-[10px] font-semibold text-slate-400 dark:text-slate-500 mb-2 uppercase tracking-widest"
                >
                  OS Tools (system PATH)
                </p>
                <div class="flex flex-wrap gap-1.5">
                  {#each $detectedOsTools as os (os.tool)}
                    <div
                      class="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors
                      {os.available
                        ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400'
                        : 'border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500'}"
                    >
                      <code class="text-[11px]">{os.tool}</code>
                      {#if os.available}
                        <span class="text-sky-500 dark:text-sky-400">&#10003;</span>
                      {:else}
                        <span class="text-slate-300 dark:text-slate-600">&times;</span>
                      {/if}
                      {#if os.version}
                        <span class="text-[10px] font-normal text-slate-400 dark:text-slate-500"
                          >{os.version}</span
                        >
                      {/if}
                      {#if os.path}
                        <span
                          class="text-[10px] font-normal text-slate-400 dark:text-slate-600 truncate max-w-[180px]"
                          title={os.path}
                        >
                          {os.path}
                        </span>
                      {/if}
                      {#if os.provider}
                        <span
                          class="rounded bg-indigo-100 dark:bg-indigo-900/30 px-1.5 py-px text-[9px] text-indigo-600 dark:text-indigo-400"
                          >{os.provider}</span
                        >
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- Cloud Configs -->
            {#if $detectedCloudConfigs.length > 0}
              <div>
                <p
                  class="text-[10px] font-semibold text-slate-400 dark:text-slate-500 mb-2 uppercase tracking-widest"
                >
                  Detected Credentials &amp; Configs
                </p>
                <div class="flex flex-wrap gap-1.5">
                  {#each $detectedCloudConfigs as config (config.configPath)}
                    <div
                      class="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs"
                    >
                      <span class="text-emerald-500 text-[10px]">&#9919;</span>
                      <span class="font-medium text-emerald-700 dark:text-emerald-400"
                        >{config.label}</span
                      >
                      <span
                        class="rounded bg-indigo-100 dark:bg-indigo-900/30 px-1.5 py-px text-[9px] text-indigo-600 dark:text-indigo-400"
                        >{config.provider}</span
                      >
                      <span
                        class="text-[10px] text-slate-400 dark:text-slate-500 truncate max-w-[180px]"
                        title={config.configPath}
                      >
                        {config.configPath
                          .replace(/^\/home\/[^/]+\//, "~/")
                          .replace(/^\/Users\/[^/]+\//, "~/")
                          .replace(/^C:\\Users\\[^\\]+\\/, "~\\")}
                      </span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- Cloud Import -->
            {#if $detectedCloudConfigs.length > 0}
              <div>
                <p
                  class="text-[10px] font-semibold text-slate-400 dark:text-slate-500 mb-2 uppercase tracking-widest"
                >
                  Import from Cloud
                </p>
                <div class="flex flex-wrap gap-1.5 mb-2">
                  {#each getSupportedCloudProviders() as provider (provider)}
                    {@const hasConfig = $detectedCloudConfigs.some((c) => c.provider === provider)}
                    <Button
                      size="sm"
                      variant={cloudImportProvider === provider ? "default" : "outline"}
                      class="text-xs h-7 {hasConfig ? '' : 'opacity-60'}"
                      disabled={cloudListLoading || cloudImportLoading}
                      onclick={() =>
                        cloudImportProvider === provider
                          ? closeCloudImport()
                          : listClouds(provider)}
                    >
                      {cloudListLoading && cloudImportProvider === provider
                        ? "Scanning"
                        : `List ${provider} clusters`}
                    </Button>
                  {/each}
                </div>

                {#if cloudImportError}
                  <div
                    class="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1 mb-2"
                  >
                    {cloudImportError}
                  </div>
                {/if}
                {#if cloudImportSuccess}
                  <div
                    class="text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/30 rounded px-2 py-1 mb-2"
                  >
                    {cloudImportSuccess}
                  </div>
                {/if}

                {#if cloudClusters.length > 0}
                  <p class="text-[10px] text-slate-400 mb-1">
                    {cloudClusters.length} cluster{cloudClusters.length === 1 ? "" : "s"} found
                  </p>
                  <div class="space-y-1">
                    {#each cloudClusters as cluster (`${cluster.provider}:${cluster.region}:${cluster.name}`)}
                      <div
                        class="flex items-center justify-between gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 px-3 py-1.5 text-xs"
                      >
                        <div class="flex items-center gap-2 min-w-0">
                          <span class="font-medium text-slate-800 dark:text-slate-200 truncate"
                            >{cluster.name}</span
                          >
                          <span class="text-[10px] text-slate-400">{cluster.region}</span>
                          {#if cluster.resourceGroup}
                            <span class="text-[10px] text-slate-400"
                              >rg:{cluster.resourceGroup}</span
                            >
                          {/if}
                          <span
                            class="rounded bg-indigo-100 dark:bg-indigo-900/30 px-1.5 py-px text-[9px] text-indigo-600 dark:text-indigo-400"
                            >{cluster.provider}</span
                          >
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          class="text-xs h-6 px-2"
                          disabled={cloudImportLoading}
                          onclick={() => importFromCloud(cluster)}
                        >
                          Import
                        </Button>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </details>
      {:else if $isCliDetectionLoading}
        <div class="flex items-center gap-2 mb-6 text-xs text-slate-400">
          <LoadingSpinner />
          <span>Detecting cloud providers...</span>
        </div>
      {/if}

      <!-- Connect Cluster Wizard (all auth methods) -->
      <div class="mb-6">
        <ConnectClusterWizard />
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div
          class="bg-white border border-slate-200 dark:bg-slate-800/60 dark:border-slate-700/60 rounded-xl shadow-sm p-6 overflow-y-auto max-h-[800px]"
        >
          <h2 class="text-lg font-semibold mb-3 text-slate-800 dark:text-slate-100">
            Detected kubeconfig files
          </h2>
          <p class="text-slate-500 dark:text-slate-400 mb-4 text-sm leading-relaxed">
            ROZOOM discovers clusters, validates access, and shows where each context comes from
            before you add it.
          </p>

          {#if !hasAvailableConfigs}
            <div class="text-center py-8 text-gray-600 dark:text-gray-300">
              <div class="text-4xl mb-2">📁</div>
              <p>No kubeconfig files found in standard locations</p>
              <p class="text-xs my-2">Use upload or import options below</p>
              <Button
                onclick={loadData}
                disabled={isLoading}
                class="dark:text-white w-full bg-indigo-600 hover:bg-indigo-700"
              >
                {#if isLoading}
                  <LoadingSpinner />
                {:else}
                  ↻ Refresh
                {/if}
              </Button>
            </div>
          {:else}
            <div class="space-y-4">
              <div
                class="rounded-lg border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-600/80 p-4"
              >
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p class="text-sm font-semibold text-gray-800 dark:text-gray-100">
                      Quick actions
                    </p>
                    <p class="text-xs text-gray-500 dark:text-gray-400">
                      {detectedClusters.length} detected · {selectedDetectedCount} selected
                    </p>
                  </div>
                  <div class="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                    <Button
                      onclick={handleAddSelectedClusters}
                      disabled={isLoading || selectedDetectedCount === 0}
                      class="text-sm dark:text-white bg-indigo-600 hover:bg-indigo-700"
                    >
                      {#if isLoading}
                        <LoadingSpinner />
                      {:else}
                        ➕ Add selected ({selectedDetectedCount})
                      {/if}
                    </Button>
                    <Button
                      onclick={handleAddAllDetected}
                      disabled={isLoading}
                      class="text-sm dark:text-white bg-indigo-600 hover:bg-indigo-700"
                    >
                      {#if isLoading}
                        <LoadingSpinner />
                      {:else}
                        ✅ Add all detected
                      {/if}
                    </Button>
                  </div>
                </div>
              </div>

              {#each detectedSourceGroups as group}
                <div
                  class="rounded-lg border border-gray-200 dark:border-slate-600 bg-white/70 dark:bg-slate-700 p-4"
                >
                  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3">
                    <div>
                      <p class="text-sm font-semibold text-gray-800 dark:text-gray-100">
                        Detected from: {group.source}
                      </p>
                      <p class="text-xs text-gray-500 dark:text-gray-400">
                        {group.clusters.length} clusters ({group.clusters.length -
                          group.clusters.filter((c) => c.alreadyAdded).length} not yet added) discovered
                        in this file
                      </p>
                    </div>
                    <Button
                      onclick={handleAddFromAvailableConfigs}
                      disabled={isLoading || !$kubeConfigFile?.clusters.length}
                      class="text-xs dark:text-white bg-indigo-600 hover:bg-indigo-700"
                    >
                      {#if isLoading}
                        <LoadingSpinner />
                      {:else}
                        ➕ Add from this source
                      {/if}
                    </Button>
                  </div>

                  <div class="space-y-3">
                    {#each group.clusters as cluster}
                      {#if !cluster.alreadyAdded}
                        <div class="rounded-lg border border-gray-200 dark:border-slate-600 p-3">
                          <div class="flex items-start gap-3">
                            <Checkbox
                              class="mt-2"
                              checked={selectedDetectedClusters[cluster.name] ?? false}
                              onCheckedChange={(checked) => {
                                selectedDetectedClusters[cluster.name] = !!checked;
                                selectedDetectedClusters = selectedDetectedClusters;
                              }}
                              disabled={cluster.alreadyAdded}
                            />
                            <div class="flex-1 space-y-2">
                              <div class="flex flex-wrap items-center gap-2">
                                <p
                                  class="font-semibold text-gray-900 dark:text-gray-100 overflow-ellipsis"
                                >
                                  {cluster.displayName}
                                </p>
                                <span
                                  class="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200"
                                >
                                  {cluster.provider}
                                </span>
                                {#if cluster.region}
                                  <span
                                    class="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-600/60 dark:text-slate-200"
                                  >
                                    {cluster.region}
                                  </span>
                                {/if}
                                <span
                                  class="text-xs px-2 py-0.5 rounded-full {cluster.status ===
                                  'ready'
                                    ? 'bg-green-50 text-green-700 dark:bg-green-500/20 dark:text-green-200'
                                    : cluster.status === 'auth-issue'
                                      ? 'bg-orange-50 text-orange-700 dark:bg-orange-500/20 dark:text-orange-200'
                                      : 'bg-red-50 text-red-700 dark:bg-red-500/20 dark:text-red-200'}"
                                >
                                  {cluster.statusLabel}
                                </span>
                                <Button
                                  onclick={() => (activeCluster = cluster)}
                                  class="text-gray-700 text-xs dark:text-white !bg-transparent ml-auto border border-gray-200 dark:border-slate-500 hover:bg-gray-100 dark:hover:bg-slate-600"
                                >
                                  View identity
                                </Button>
                              </div>

                              <div
                                class="flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-300"
                              >
                                <span
                                  class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] {cluster
                                    .authInfo.securityLevel === 'high'
                                    ? 'bg-emerald-500/10 text-emerald-400'
                                    : cluster.authInfo.securityLevel === 'medium'
                                      ? 'bg-amber-500/10 text-amber-400'
                                      : cluster.authInfo.securityLevel === 'low'
                                        ? 'bg-rose-500/10 text-rose-400'
                                        : 'bg-slate-500/10 text-slate-400'}"
                                  title={cluster.authInfo.description}
                                >
                                  {cluster.authInfo.securityLevel === "high"
                                    ? "🛡"
                                    : cluster.authInfo.securityLevel === "low"
                                      ? "⚠"
                                      : ""}
                                  {cluster.authInfo.label}
                                </span>
                                {#if cluster.authInfo.tokenExpired}
                                  <span
                                    class="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 animate-pulse"
                                    >Token expired</span
                                  >
                                {:else if cluster.authInfo.tokenExpiresInHours != null && cluster.authInfo.tokenExpiresInHours < 24}
                                  <span
                                    class="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400"
                                    >Expires {Math.round(
                                      cluster.authInfo.tokenExpiresInHours,
                                    )}h</span
                                  >
                                {/if}
                                <span>Env: {cluster.env}</span>
                                {#if cluster.contextName}
                                  <span>Context: {cluster.contextName}</span>
                                {/if}
                              </div>

                              <div class="flex flex-wrap items-center gap-2">
                                {#each cluster.tags as tag}
                                  <span
                                    class="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-600/60 dark:text-slate-200"
                                  >
                                    #{tag}
                                  </span>
                                {/each}
                                {#if cluster.warnings.length}
                                  <span
                                    class="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/20 dark:text-amber-100"
                                    title={cluster.warnings.join(", ")}
                                  >
                                    ⚠️ Hygiene warning
                                  </span>
                                {/if}
                                {#if cluster.importWarnings.length}
                                  <span
                                    class="text-[11px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 dark:bg-rose-500/20 dark:text-rose-100"
                                    title={cluster.importWarnings.join(" ")}
                                  >
                                    Verify context before add
                                  </span>
                                {/if}
                              </div>

                              {#if cluster.importWarnings.length}
                                <div
                                  class="rounded-md border border-rose-200 bg-rose-50/80 px-3 py-2 text-xs text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100"
                                >
                                  {#each cluster.importWarnings as warning}
                                    <p>{warning}</p>
                                  {/each}
                                </div>
                              {/if}

                              <div class="flex gap-2 items-center">
                                <Label
                                  for={`display-name-${toSafeId(cluster.name)}`}
                                  class="text-nowrap"
                                >
                                  Display name
                                </Label>
                                <Input
                                  type="text"
                                  id={`display-name-${toSafeId(cluster.name)}`}
                                  class="border-gray-200 dark:border-slate-500 bg-gray-100 dark:bg-slate-800/30"
                                  value={displayNameOverride(cluster.name)}
                                  oninput={(event) =>
                                    setDisplayNameOverride(
                                      cluster.name,
                                      (event.currentTarget as HTMLInputElement).value,
                                    )}
                                  placeholder={cluster.name}
                                />
                              </div>
                              <div class="flex gap-2 items-center">
                                <Label class="text-nowrap" for={`env-${toSafeId(cluster.name)}`}>
                                  Env
                                </Label>

                                <Select.Root
                                  type="single"
                                  value={envOverride(cluster.name)}
                                  onValueChange={(value) => setEnvOverride(cluster.name, value)}
                                >
                                  <Select.Trigger
                                    class="border-gray-200 dark:border-slate-500 bg-white dark:bg-slate-700"
                                    >{managedEnvOptions.find(
                                      (c) => c.value === envOverride(cluster.name),
                                    )?.label ?? "Select env"}</Select.Trigger
                                  >
                                  <Select.Content>
                                    <Select.Group>
                                      {#each managedEnvOptions as env}
                                        <Select.Item value={env.value}>{env.label}</Select.Item>
                                      {/each}
                                    </Select.Group>
                                  </Select.Content>
                                </Select.Root>
                              </div>
                            </div>
                          </div>
                        </div>
                      {/if}
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          {/if}

          <div
            class="rounded-lg border border-dashed border-gray-200 dark:border-slate-500 bg-gray-100 dark:bg-slate-700/40 p-3 text-xs text-gray-600 dark:text-gray-300 mt-4"
          >
            <p class="font-semibold text-gray-700 dark:text-gray-200 mb-2">Smart discovery</p>
            <ul class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {#each scanningPaths as path}
                <li class="flex items-center gap-2">
                  <span class="text-indigo-500">•</span>
                  <span>{path}</span>
                </li>
              {/each}
            </ul>
          </div>
        </div>

        <div
          class="bg-white border border-slate-200 dark:bg-slate-800/60 dark:border-slate-700/60 rounded-xl shadow-sm p-6 overflow-y-auto max-h-[800px]"
        >
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100">
              Managed Clusters
            </h2>
            <Button
              onclick={openDashboard}
              disabled={isLoading || clustersCount === 0}
              size="sm"
              class="bg-indigo-600 hover:bg-indigo-700 dark:text-white text-xs h-8 px-3"
            >
              🚀 Open Cluster Dashboard
            </Button>
          </div>
          {#if clustersCount !== 0}
            <p class="text-gray-600 dark:text-gray-300 mb-4 text-sm">
              {clustersCount} Clusters added to ROZOOM - K8s Linter IDE with status, tags, and trust
              signals
            </p>
          {/if}
          <div class="space-y-3 mb-4">
            <div class="flex flex-col lg:flex-row gap-3">
              <Input
                class="border-gray-200 dark:border-slate-500 bg-gray-100 dark:bg-slate-800/30"
                type="text"
                placeholder="Filter by name or tag"
                bind:value={managedSearch}
              />
            </div>
            <div class="flex flex-col lg:flex-row gap-3">
              <Select.Root type="single" bind:value={managedStatusFilter}>
                <Select.Trigger
                  class="border-gray-200 dark:border-slate-500 bg-white dark:bg-slate-700"
                  >{triggerShowClusters}</Select.Trigger
                >
                <Select.Content>
                  <Select.Group>
                    {#each managedStatusFilterOptions as status}
                      <Select.Item value={status.value}>{status.label}</Select.Item>
                    {/each}
                  </Select.Group>
                </Select.Content>
              </Select.Root>

              <Select.Root type="single" bind:value={managedProviderFilter}>
                <Select.Trigger
                  class="border-gray-200 dark:border-slate-500 bg-white dark:bg-slate-700"
                  >{triggerShowProviders}</Select.Trigger
                >
                <Select.Content>
                  <Select.Group>
                    {#each managedProvidersFilterOptions as provider}
                      <Select.Item value={provider.value}>{provider.label}</Select.Item>
                    {/each}
                  </Select.Group>
                </Select.Content>
              </Select.Root>

              <Select.Root type="single" bind:value={managedEnvFilter}>
                <Select.Trigger
                  class="border-gray-200 dark:border-slate-500 bg-white dark:bg-slate-700"
                  >{triggerShowEnvs}</Select.Trigger
                >
                <Select.Content>
                  <Select.Group>
                    {#each managedEnvFilterOptions as env}
                      <Select.Item value={env.value}>{env.label}</Select.Item>
                    {/each}
                  </Select.Group>
                </Select.Content>
              </Select.Root>
            </div>

            <div
              class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-gray-200 dark:border-slate-500 px-3 py-2 text-xs text-gray-600 dark:text-gray-300"
            >
              <div class="flex items-center gap-2">
                <Checkbox
                  id="select-all"
                  checked={selectedManagedClusters.__all ?? false}
                  onCheckedChange={(checked) => {
                    selectedManagedClusters = buildManagedSelection({
                      view: managedClustersView,
                      allSelected: !!checked,
                      previous: selectedManagedClusters,
                    });
                  }}
                />
                <span>Bulk actions</span>
              </div>
              <div class="flex flex-wrap gap-2">
                <Button
                  onclick={handleRemoveSelectedClusters}
                  disabled={isLoading || selectedManagedCount === 0}
                  class="text-xs dark:text-white bg-red-500 hover:bg-red-600"
                >
                  🗑️ Remove selected ({selectedManagedCount})
                </Button>
              </div>
            </div>
          </div>

          {#if clustersCount === 0}
            <div class="text-center py-8 text-gray-500 dark:text-gray-300">
              <div class="text-4xl mb-2">🏗️</div>
              <p>No clusters added yet</p>
              <p class="text-xs mt-1">Add clusters from available configs or upload new ones</p>
            </div>
          {:else}
            <div class="space-y-3 mb-4">
              {#each managedClustersView as cluster}
                <div
                  class="rounded-lg p-4 {cluster?.offline
                    ? 'bg-gray-50 dark:bg-slate-700 dark:border-slate-600 border border-gray-200'
                    : 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700'}"
                >
                  <div class="flex items-start gap-2.5">
                    <Checkbox
                      checked={selectedManagedClusters[cluster.uuid]}
                      class="mt-1 shrink-0"
                    />
                    <div class="min-w-0 flex-1">
                      <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0 flex-1 group">
                          <p
                            class="font-medium text-sm text-gray-900 dark:text-gray-100 truncate cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                            title="Click to rename: {cluster.displayName}"
                            role="button"
                            tabindex="0"
                            onclick={async () => {
                              const newName = prompt(
                                "Rename cluster context:",
                                cluster.displayName,
                              );
                              if (
                                newName &&
                                newName.trim() &&
                                newName.trim() !== cluster.displayName
                              ) {
                                const trimmed = newName.trim();
                                await renameClusterContext(cluster.uuid, trimmed);
                              }
                            }}
                            onkeydown={(e) => {
                              if (e.key === "Enter") e.currentTarget.click();
                            }}
                          >
                            {cluster.displayName}
                            <span
                              class="opacity-0 group-hover:opacity-50 text-[10px] transition-opacity"
                              >&#9998;</span
                            >
                          </p>
                          {#if cluster.displayName !== cluster.name}
                            <p
                              class="text-[11px] text-gray-400 dark:text-gray-500 truncate"
                              title={cluster.name}
                            >
                              {cluster.name}
                            </p>
                          {/if}
                        </div>
                        <div class="flex items-center gap-1 shrink-0">
                          <Button
                            onclick={() => handleTogglePin(cluster.uuid)}
                            variant="outline"
                            size="sm"
                            class="text-[11px] h-7 px-2 dark:text-white !bg-transparent border-gray-200 dark:border-slate-500"
                            disabled={isLoading}
                          >
                            {cluster.pinned ? "Unpin" : "📌"}
                          </Button>
                          <Button
                            onclick={() => handleToggleConnection(cluster.uuid)}
                            variant={cluster?.offline ? "outline" : "default"}
                            size="sm"
                            class="text-[11px] h-7 px-2 dark:text-white"
                            disabled={isLoading}
                          >
                            {cluster?.offline ? "Offline" : "Online"}
                          </Button>
                          <Button
                            onclick={() => handleRemoveCluster(cluster.uuid, cluster.name)}
                            disabled={isLoading}
                            variant="ghost"
                            size="sm"
                            class="text-red-500 hover:text-red-600 h-7 w-7 p-0"
                          >
                            <Trash class="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div class="flex flex-wrap items-center gap-1 mt-1">
                        <span
                          class="text-[11px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200"
                          >{cluster.provider}</span
                        >
                        <span
                          class="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-600/60 dark:text-slate-200"
                          >{cluster.env}</span
                        >
                        {#if cluster.readOnly}
                          <span
                            class="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-500/30 dark:text-slate-300"
                            >Read-only</span
                          >
                        {/if}
                        {#if cluster.proxyUrl}
                          <span
                            class="text-[11px] px-1.5 py-0.5 rounded-full bg-cyan-50 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300"
                            title={cluster.proxyUrl}>Proxy</span
                          >
                        {/if}
                        {#if cluster.pinnedKubectlVersion}
                          <span
                            class="text-[11px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300"
                            >kubectl {cluster.pinnedKubectlVersion}</span
                          >
                        {/if}
                        {#if cluster.pinned}
                          <span
                            class="text-[11px] px-1.5 py-0.5 rounded-full bg-yellow-50 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-200"
                            >Pinned</span
                          >
                        {/if}
                        <span class="text-[10px] text-gray-400 ml-1">
                          {new Date(cluster.addedAt).toLocaleDateString()} · {cluster.offline
                            ? `Last: ${new Date(cluster.lastSeen).toLocaleDateString()}`
                            : "Online"}
                        </span>
                      </div>
                      {#if cluster.tags.length > 0}
                        <div class="flex flex-wrap gap-1 mt-1">
                          {#each cluster.tags as tag}
                            <span
                              class="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-600/40 dark:text-slate-400"
                              >#{tag}</span
                            >
                          {/each}
                        </div>
                      {/if}
                      <div class="flex items-center gap-3 mt-1.5 flex-wrap">
                        <div class="flex items-center gap-1">
                          <span class="text-[10px] text-slate-400 dark:text-slate-500 shrink-0"
                            >Default ns:</span
                          >
                          <input
                            type="text"
                            class="h-5 text-[11px] px-1.5 py-0 rounded border border-slate-200 dark:border-slate-600 bg-transparent text-slate-700 dark:text-slate-300 w-24 placeholder:text-slate-300 dark:placeholder:text-slate-600"
                            placeholder="all"
                            value={cluster.defaultNamespace ?? ""}
                            onchange={(e) =>
                              updateClusterMeta(cluster.uuid, {
                                defaultNamespace:
                                  (e.currentTarget as HTMLInputElement).value || undefined,
                              })}
                          />
                        </div>
                        <div class="flex items-center gap-1">
                          <span class="text-[10px] text-slate-400 dark:text-slate-500 shrink-0"
                            >Proxy:</span
                          >
                          <input
                            type="text"
                            class="h-5 text-[11px] px-1.5 py-0 rounded border border-slate-200 dark:border-slate-600 bg-transparent text-slate-700 dark:text-slate-300 w-32 placeholder:text-slate-300 dark:placeholder:text-slate-600"
                            placeholder="none"
                            value={cluster.proxyUrl ?? ""}
                            onchange={(e) =>
                              updateClusterMeta(cluster.uuid, {
                                proxyUrl: (e.currentTarget as HTMLInputElement).value || undefined,
                              })}
                          />
                        </div>
                        <div class="flex items-center gap-1">
                          <span class="text-[10px] text-slate-400 dark:text-slate-500 shrink-0"
                            >kubectl:</span
                          >
                          <input
                            type="text"
                            class="h-5 text-[11px] px-1.5 py-0 rounded border border-slate-200 dark:border-slate-600 bg-transparent text-slate-700 dark:text-slate-300 w-20 placeholder:text-slate-300 dark:placeholder:text-slate-600"
                            placeholder="bundled"
                            value={cluster.pinnedKubectlVersion ?? ""}
                            onchange={(e) =>
                              updateClusterMeta(cluster.uuid, {
                                pinnedKubectlVersion:
                                  (e.currentTarget as HTMLInputElement).value || undefined,
                              })}
                          />
                        </div>
                        <label class="flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            class="w-3 h-3 rounded border-slate-400 accent-amber-500"
                            checked={cluster.readOnly ?? false}
                            onchange={(e) =>
                              updateClusterMeta(cluster.uuid, {
                                readOnly: (e.currentTarget as HTMLInputElement).checked,
                              })}
                          />
                          <span class="text-[10px] text-slate-400 dark:text-slate-500"
                            >Read-only</span
                          >
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {/if}

          <div class="mt-6 flex justify-end">
            <Button
              onclick={openDashboard}
              disabled={isLoading || clustersCount === 0}
              class="bg-indigo-600 hover:bg-indigo-700 dark:text-white"
            >
              🚀 Open Cluster Dashboard
            </Button>
          </div>
        </div>

        <div
          class="bg-white/70 backdrop-blur-sm border border-slate-200/50 dark:bg-slate-700 rounded-lg shadow-md p-6"
        >
          <h2 class="text-xl font-semibold mb-4 text-gray-800 dark:text-white">
            📁 Upload kubeconfig file
          </h2>
          <p class="text-gray-600 dark:text-gray-300 mb-4 text-sm">
            Upload an existing kubeconfig file to import clusters
          </p>

          <Button
            onclick={handleUploadConfigFile}
            disabled={isLoading}
            class="dark:text-white bg-indigo-600 hover:bg-indigo-700"
          >
            {#if isLoading}
              <LoadingSpinner />
            {:else}
              📤 Upload kubeconfig
            {/if}
          </Button>
        </div>

        <div
          class="bg-white/70 backdrop-blur-sm border border-slate-200/50 dark:bg-slate-700 rounded-lg shadow-md p-6"
        >
          <h2 class="text-xl font-semibold mb-4 text-gray-800 dark:text-white">
            📝 Paste kubeconfig YAML
          </h2>
          <p class="text-gray-600 dark:text-gray-300 mb-4 text-sm">
            Paste kubeconfig content manually (YAML format)
          </p>

          <Textarea
            bind:value={rawConfigData}
            class="min-h-32 font-mono text-sm border-gray-200 dark:border-slate-500 bg-gray-100 dark:bg-slate-800/30"
            placeholder="Paste kubeconfig YAML here…"
            oninput={clearClustersConfigMessages}
          />

          <div class="mt-4">
            <Button
              onclick={handleImportFromText}
              disabled={!rawConfigData.trim() || isLoading}
              class="dark:text-white bg-indigo-600 hover:bg-indigo-700"
            >
              {#if isLoading}
                <LoadingSpinner />
              {:else}
                ⚡ Import clusters
              {/if}
            </Button>
          </div>
        </div>
      </div>

      <!-- Catalog Export/Import -->
      <div
        class="mt-6 bg-white/70 backdrop-blur-sm border border-slate-200/50 dark:bg-slate-700 rounded-lg shadow-md p-6"
      >
        <h2 class="text-xl font-semibold mb-4 text-gray-800 dark:text-white">
          Catalog Export / Import
        </h2>
        <p class="text-gray-600 dark:text-gray-300 mb-4 text-sm">
          Export cluster groups, tags, and display names as JSON (no secrets). Import on another
          machine.
        </p>
        <div class="flex gap-2">
          <Button
            onclick={async () => {
              const { exportCatalog } = await import(
                "$features/cluster-manager/model/catalog-export"
              );
              const { loadGroups, loadGroupMembership } = await import(
                "$shared/lib/cluster-groups"
              );
              const groups = await loadGroups();
              const membership = await loadGroupMembership();
              const catalog = exportCatalog($clustersList, groups, membership);
              const json = JSON.stringify(catalog, null, 2);
              await navigator.clipboard.writeText(json);
              toast.success("Catalog copied to clipboard! Paste into a .json file to share.");
            }}
            disabled={isLoading || clustersCount === 0}
            class="dark:text-white bg-emerald-600 hover:bg-emerald-700 text-xs"
            size="sm"
          >
            Export to clipboard
          </Button>
          <Button
            onclick={async () => {
              const json = prompt("Paste catalog JSON:");
              if (!json?.trim()) return;
              const { importCatalog } = await import(
                "$features/cluster-manager/model/catalog-export"
              );
              const result = importCatalog(json);
              if (result.error) {
                toast.error("Import failed: " + result.error);
                return;
              }
              toast.success(
                `Catalog loaded: ${result.catalog!.clusters.length} clusters, ${result.catalog!.groups.length} groups. Apply metadata manually.`,
              );
            }}
            disabled={isLoading}
            variant="outline"
            class="text-xs"
            size="sm"
          >
            Import from clipboard
          </Button>
        </div>
      </div>

      {#if activeCluster}
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div class="w-full max-w-xl rounded-xl bg-white dark:bg-slate-800 p-6 shadow-xl">
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Cluster Identity Card
                </p>
                <h3 class="text-xl font-semibold text-gray-900 dark:text-white">
                  {activeCluster.displayName}
                </h3>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {activeCluster.name}
                </p>
              </div>
              <button
                onclick={() => (activeCluster = null)}
                class="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div class="mt-4 space-y-3 text-sm text-gray-700 dark:text-gray-200">
              <div class="flex flex-wrap gap-3">
                <span
                  class="rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200 px-3 py-1 text-xs"
                >
                  {activeCluster.provider}
                </span>
                {#if activeCluster.region}
                  <span
                    class="rounded-full bg-slate-100 text-slate-600 dark:bg-slate-600/60 dark:text-slate-200 px-3 py-1 text-xs"
                  >
                    Region: {activeCluster.region}
                  </span>
                {/if}
                <span
                  class="rounded-full bg-slate-100 text-slate-600 dark:bg-slate-600/60 dark:text-slate-200 px-3 py-1 text-xs"
                >
                  Auth: {activeCluster.authMethod}
                </span>
                <span
                  class="rounded-full bg-slate-100 text-slate-600 dark:bg-slate-600/60 dark:text-slate-200 px-3 py-1 text-xs"
                >
                  Status: {activeCluster.statusLabel}
                </span>
              </div>
              <div class="space-y-1 text-xs text-gray-500 dark:text-gray-400">
                <p>Detected from: {activeCluster.source}</p>
                {#if activeCluster.contextName}
                  <p>Context: {activeCluster.contextName}</p>
                {/if}
                <p>Environment: {activeCluster.env}</p>
              </div>
              {#if activeCluster.warnings.length}
                <div
                  class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
                >
                  <p class="font-semibold mb-1">Kubeconfig hygiene warnings</p>
                  <ul class="list-disc pl-4">
                    {#each activeCluster.warnings as warning}
                      <li>{warning}</li>
                    {/each}
                  </ul>
                </div>
              {/if}
              {#if activeCluster.importWarnings.length}
                <div
                  class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100"
                >
                  <p class="font-semibold mb-1">Import preflight</p>
                  <ul class="list-disc pl-4">
                    {#each activeCluster.importWarnings as warning}
                      <li>{warning}</li>
                    {/each}
                  </ul>
                </div>
              {/if}
              <div class="flex flex-wrap gap-2">
                {#each activeCluster.tags as tag}
                  <span
                    class="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-600/60 dark:text-slate-200"
                  >
                    #{tag}
                  </span>
                {/each}
              </div>
            </div>

            <div class="mt-6 flex flex-col sm:flex-row gap-3">
              <Button
                onclick={() => activeCluster && handleAddSingleCluster(activeCluster)}
                disabled={activeCluster?.alreadyAdded || isLoading}
                class="flex-1 dark:text-white bg-indigo-600 hover:bg-indigo-700"
              >
                {activeCluster.alreadyAdded ? "Already managed" : "➕ Add this cluster"}
              </Button>
              <Button
                onclick={() => (activeCluster = null)}
                class="flex-1 dark:text-white bg-slate-200 hover:bg-slate-300 dark:bg-slate-600 dark:hover:bg-slate-500"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- Removed Clusters (Trash) -->
    {#if $removedClustersList.length > 0}
      <div
        class="mt-6 bg-white border border-slate-200 dark:bg-slate-800/60 dark:border-slate-700/60 rounded-xl shadow-sm p-6"
      >
        <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">
          Recently Removed ({$removedClustersList.length})
        </h2>
        <p class="text-xs text-slate-400 dark:text-slate-500 mb-3">
          Clusters moved to trash. Restore or permanently delete.
        </p>
        <div class="space-y-1.5">
          {#each $removedClustersList as cluster (cluster.uuid)}
            <div
              class="flex items-center justify-between gap-3 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 px-3 py-2 text-sm"
            >
              <div class="flex items-center gap-2 min-w-0">
                <span class="font-medium text-slate-700 dark:text-slate-300 truncate"
                  >{cluster.displayName || cluster.name}</span
                >
                {#if cluster.provider}
                  <span
                    class="rounded bg-indigo-100 dark:bg-indigo-900/30 px-1.5 py-px text-[9px] text-indigo-600 dark:text-indigo-400"
                    >{cluster.provider}</span
                  >
                {/if}
                {#if cluster.removedAt}
                  <span class="text-[10px] text-slate-400"
                    >removed {new Date(cluster.removedAt).toLocaleDateString()}</span
                  >
                {/if}
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  class="text-xs h-6 px-2 text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-700 dark:hover:bg-emerald-900/20"
                  onclick={async () => {
                    await restoreCluster(cluster.uuid);
                    void recordAudit("cluster-restored", {
                      clusterName: cluster.name,
                      clusterUuid: cluster.uuid,
                    });
                  }}
                >
                  Restore
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  class="text-xs h-6 px-2 text-rose-600 border-rose-300 hover:bg-rose-50 dark:text-rose-400 dark:border-rose-700 dark:hover:bg-rose-900/20"
                  onclick={async () => {
                    const yes = await safeDialogAsk(
                      `Permanently delete "${cluster.displayName || cluster.name}"? This cannot be undone.`,
                      { title: "Purge cluster", kind: "warning" },
                    );
                    if (yes) {
                      await purgeCluster(cluster.uuid);
                      void recordAudit("cluster-purged", {
                        clusterName: cluster.name,
                        clusterUuid: cluster.uuid,
                      });
                    }
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
    <!-- Audit Trail -->
    {#await import("$features/cluster-manager/model/audit-trail").then( (m) => m.loadAuditTrail(), ) then trail}
      {#if trail.length > 0}
        <div
          class="mt-6 bg-white border border-slate-200 dark:bg-slate-800/60 dark:border-slate-700/60 rounded-xl shadow-sm p-6"
        >
          <details>
            <summary
              class="text-lg font-semibold text-slate-800 dark:text-slate-100 cursor-pointer"
            >
              Audit Trail ({trail.length})
            </summary>
            <div class="mt-3 space-y-1 max-h-64 overflow-y-auto">
              {#each trail.slice(0, 50) as entry (entry.id)}
                <div
                  class="flex items-center gap-2 text-xs text-slate-400 py-0.5 border-b border-slate-100 dark:border-slate-700/40"
                >
                  <span class="text-[10px] font-mono text-slate-500 shrink-0 w-36"
                    >{new Date(entry.timestamp).toLocaleString()}</span
                  >
                  <span
                    class="px-1.5 py-0.5 rounded text-[9px] font-medium
                    {entry.action.includes('removed') || entry.action.includes('purged')
                      ? 'bg-rose-500/10 text-rose-400'
                      : entry.action.includes('restored') || entry.action.includes('added')
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-slate-500/10 text-slate-400'}">{entry.action}</span
                  >
                  {#if entry.clusterName}
                    <span class="text-slate-300 truncate">{entry.clusterName}</span>
                  {/if}
                  {#if entry.details}
                    <span class="text-slate-500 truncate">{entry.details}</span>
                  {/if}
                </div>
              {/each}
            </div>
          </details>
        </div>
      {/if}
    {/await}
  </main>
{/if}
