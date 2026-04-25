<script lang="ts">
  import { onMount } from "svelte";
  import {
    OIDC_PRESETS,
    generateOidcKubeconfig,
    type OidcProvider,
  } from "$features/cluster-manager/model/oidc-config";
  import {
    buildVaultLoginPayload,
    type VaultAuthMethod,
  } from "$features/cluster-manager/model/vault-integration";
  import {
    EXEC_PLUGIN_PRESETS,
    getExecPluginPreset,
    generateExecKubeconfig,
    type ExecPluginKind,
  } from "$features/cluster-manager/model/exec-plugin";
  import {
    listCloudClusters,
    listCloudScopes,
    listCloudClustersAllScopes,
    importCloudCluster,
    getSupportedCloudProviders,
    type CloudCluster,
    type CloudScope,
  } from "$features/cluster-manager/api/cloud-import";
  import { addClustersFromText } from "$features/cluster-manager";
  import { detectedCloudConfigs } from "$features/cluster-finder/model/cli-store";
  import { Button } from "$shared/ui/button";
  import { KeyRound, Cloud, Vault, FileText, Ticket, TerminalSquare } from "$shared/ui/icons";

  type ConnectMethod = "exec" | "oidc" | "cloud" | "vault" | "certificate" | "token" | null;

  const STORAGE_METHOD = "connect-cluster:last-method";
  const STORAGE_OIDC = "connect-cluster:oidc-defaults";
  const STORAGE_EXEC = "connect-cluster:exec-kind";

  let method = $state<ConnectMethod>(null);
  let error = $state<string | null>(null);
  let success = $state<string | null>(null);
  let loading = $state(false);

  // ── OIDC state ──
  let oidcProvider = $state<OidcProvider>("generic");
  let oidcClusterName = $state("");
  let oidcServerUrl = $state("");
  let oidcIssuerUrl = $state("");
  let oidcClientId = $state("");
  let oidcClientSecret = $state("");
  let oidcCaData = $state("");

  // ── Cloud state ──
  let cloudProvider = $state("AWS EKS");
  let cloudRegion = $state("");
  let cloudScope = $state("");
  let cloudScopes = $state<CloudScope[]>([]);
  let cloudScopeLabel = $state("Scope");
  let cloudScopesLoading = $state(false);
  let cloudClusters = $state<CloudCluster[]>([]);
  let cloudLoading = $state(false);
  let cloudErrors = $state<Array<{ scope: string; error: string }>>([]);

  // ── Auto-detect state ──
  let autoClusters = $state<CloudCluster[]>([]);
  let autoErrors = $state<Array<{ scope: string; error: string }>>([]);
  let autoLoading = $state(false);
  let autoScanned = $state(false);
  let autoSelected = $state<Set<string>>(new Set());

  // ── Vault state ──
  let vaultAddress = $state("");
  let vaultAuthMethod = $state<VaultAuthMethod>("token");
  let vaultToken = $state("");
  let vaultSecretPath = $state("");
  let vaultRole = $state("");
  let vaultNamespace = $state("");

  // ── Certificate state ──
  let certClusterName = $state("");
  let certServerUrl = $state("");
  let certCaData = $state("");
  let certClientCert = $state("");
  let certClientKey = $state("");

  // ── Token state ──
  let tokenClusterName = $state("");
  let tokenServerUrl = $state("");
  let tokenCaData = $state("");
  let tokenValue = $state("");

  // ── Exec-plugin state ──
  let execKind = $state<ExecPluginKind>("aws-eks");
  let execClusterName = $state("");
  let execServerUrl = $state("");
  let execCaData = $state("");
  let execPrimary = $state("");
  let execSecondary = $state("");
  let execTertiary = $state("");
  let execExtra = $state("");
  let execCommand = $state("");

  const oidcPreset = $derived(OIDC_PRESETS.find((p) => p.provider === oidcProvider)!);
  const execPreset = $derived(getExecPluginPreset(execKind));

  // Method catalog (shared for UI + recency restore).
  const METHODS: Array<{
    id: Exclude<ConnectMethod, null>;
    label: string;
    desc: string;
    icon: typeof KeyRound;
    security: "high" | "medium";
    securityDetail: string;
  }> = [
    {
      id: "cloud",
      label: "Cloud Provider",
      desc: "AWS EKS, GKE, AKS (one-click)",
      icon: Cloud,
      security: "high",
      securityDetail:
        "Uses your cloud CLI credentials (aws/gcloud/az). Tokens rotate via the provider's auth flow. Recommended.",
    },
    {
      id: "exec",
      label: "Exec Plugin",
      desc: "client-go credential plugin (no secrets on disk)",
      icon: TerminalSquare,
      security: "high",
      securityDetail:
        "Per k8s docs: plugin returns a short-lived token on every API call. Nothing long-lived is stored. Recommended by upstream for all production access.",
    },
    {
      id: "vault",
      label: "HashiCorp Vault",
      desc: "Dynamic credentials from Vault",
      icon: Vault,
      security: "high",
      securityDetail:
        "Credentials are fetched from Vault on demand, never stored at rest. Requires a reachable Vault server.",
    },
    {
      id: "certificate",
      label: "X.509 Certificate",
      desc: "Client cert + key (mTLS)",
      icon: FileText,
      security: "high",
      securityDetail:
        "Mutual TLS pinned to a specific key pair. Highest assurance, but you manage rotation yourself.",
    },
    {
      id: "oidc",
      label: "Manual OIDC",
      desc: "Advanced: hand-write OIDC exec block",
      icon: KeyRound,
      security: "high",
      securityDetail:
        "For admins who configure the OIDC issuer manually. Most users should pick Cloud Provider or Exec Plugin above.",
    },
    {
      id: "token",
      label: "Bearer Token",
      desc: "Static or service account token",
      icon: Ticket,
      security: "medium",
      securityDetail:
        "Long-lived token stored as-is. No auto-rotation. Prefer Cloud Provider, Exec Plugin, or projected ServiceAccount tokens for production.",
    },
  ];

  function clearMessages() {
    error = null;
    success = null;
  }

  function persistMethod(next: ConnectMethod) {
    try {
      if (next) localStorage.setItem(STORAGE_METHOD, next);
      else localStorage.removeItem(STORAGE_METHOD);
    } catch {
      /* storage unavailable */
    }
  }

  function persistOidcDefaults() {
    try {
      localStorage.setItem(
        STORAGE_OIDC,
        JSON.stringify({
          provider: oidcProvider,
          issuerUrl: oidcIssuerUrl,
          clientId: oidcClientId,
        }),
      );
    } catch {
      /* storage unavailable */
    }
  }

  function restoreOidcDefaults() {
    try {
      const raw = localStorage.getItem(STORAGE_OIDC);
      if (!raw) return;
      const data = JSON.parse(raw) as {
        provider?: OidcProvider;
        issuerUrl?: string;
        clientId?: string;
      };
      if (data.provider && OIDC_PRESETS.some((p) => p.provider === data.provider)) {
        oidcProvider = data.provider;
      }
      if (typeof data.issuerUrl === "string") oidcIssuerUrl = data.issuerUrl;
      if (typeof data.clientId === "string") oidcClientId = data.clientId;
    } catch {
      /* ignore */
    }
  }

  function selectMethod(next: ConnectMethod) {
    method = next;
    persistMethod(next);
    clearMessages();
    if (next === "cloud") void loadScopesForProvider();
  }

  function resetAll() {
    selectMethod(null);
    loading = false;
  }

  function autoKey(c: CloudCluster): string {
    return `${c.provider}::${c.scope ?? ""}::${c.region}::${c.name}`;
  }

  async function runAutoDetect() {
    const configs = $detectedCloudConfigs;
    if (configs.length === 0) {
      autoScanned = true;
      return;
    }
    autoLoading = true;
    autoClusters = [];
    autoErrors = [];
    const uniqueProviders = Array.from(new Set(configs.map((c) => c.provider)));
    const supported = new Set(getSupportedCloudProviders());
    const results = await Promise.allSettled(
      uniqueProviders.filter((p) => supported.has(p)).map((p) => listCloudClustersAllScopes(p)),
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        autoClusters.push(...r.value.clusters);
        autoErrors.push(...r.value.errors);
      }
    }
    autoLoading = false;
    autoScanned = true;
  }

  function toggleAutoSelection(c: CloudCluster) {
    const k = autoKey(c);
    const next = new Set(autoSelected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    autoSelected = next;
  }

  function toggleAutoSelectAll() {
    if (autoSelected.size === autoClusters.length) autoSelected = new Set();
    else autoSelected = new Set(autoClusters.map(autoKey));
  }

  async function importAutoSelected() {
    if (autoSelected.size === 0) return;
    clearMessages();
    loading = true;
    const picked = autoClusters.filter((c) => autoSelected.has(autoKey(c)));
    let imported = 0;
    const importedKeys = new Set<string>();
    const failures: string[] = [];
    for (const cluster of picked) {
      const result = await importCloudCluster(cluster);
      if (result.success && result.kubeconfigYaml) {
        try {
          await addClustersFromText(result.kubeconfigYaml);
          imported += 1;
          importedKeys.add(autoKey(cluster));
        } catch (e) {
          failures.push(`${cluster.name}: ${(e as Error).message}`);
        }
      } else {
        failures.push(`${cluster.name}: ${result.error ?? "import failed"}`);
      }
    }
    loading = false;
    if (imported > 0) {
      // Remove only the clusters that were successfully imported so that
      // failed ones remain in the list and can be retried.
      autoClusters = autoClusters.filter((c) => !importedKeys.has(autoKey(c)));
      autoSelected = new Set(
        [...autoSelected].filter((k) => !importedKeys.has(k)),
      );
      success = `Imported ${imported} cluster${imported === 1 ? "" : "s"}.`;
    }
    if (failures.length > 0) error = failures.join("; ");
  }

  // ── OIDC import ──
  async function importOidc() {
    clearMessages();
    if (
      !oidcClusterName.trim() ||
      !oidcServerUrl.trim() ||
      !oidcIssuerUrl.trim() ||
      !oidcClientId.trim()
    ) {
      error = "Fill in all required fields.";
      return;
    }
    loading = true;
    try {
      const yaml = generateOidcKubeconfig(
        oidcClusterName.trim(),
        oidcServerUrl.trim(),
        oidcCaData.trim() || null,
        {
          provider: oidcProvider,
          issuerUrl: oidcIssuerUrl.trim(),
          clientId: oidcClientId.trim(),
          clientSecret: oidcClientSecret.trim() || undefined,
        },
      );
      await addClustersFromText(yaml);
      success = `Cluster "${oidcClusterName}" added with ${oidcPreset.label} OIDC.`;
      persistOidcDefaults();
      oidcClusterName = "";
      oidcServerUrl = "";
      oidcClientSecret = "";
      oidcCaData = "";
    } catch (e) {
      error = (e as Error).message;
    }
    loading = false;
  }

  // ── Cloud import ──
  async function loadScopesForProvider(provider: string = cloudProvider) {
    cloudScope = "";
    cloudScopes = [];
    cloudScopeLabel = "Scope";
    cloudScopesLoading = true;
    const result = await listCloudScopes(provider);
    cloudScopesLoading = false;
    if (provider !== cloudProvider) return;
    cloudScopeLabel = result.label;
    if (result.error) return;
    cloudScopes = result.scopes;
  }

  async function listClouds() {
    clearMessages();
    cloudLoading = true;
    cloudClusters = [];
    cloudErrors = [];
    const result = await listCloudClusters(
      cloudProvider,
      cloudRegion.trim() || undefined,
      cloudScope || undefined,
    );
    cloudLoading = false;
    if (result.error) {
      error = result.error;
      return;
    }
    cloudClusters = result.clusters;
    if (cloudClusters.length === 0) error = "No clusters found.";
  }

  async function scanAllScopes() {
    clearMessages();
    cloudLoading = true;
    cloudClusters = [];
    cloudErrors = [];
    const result = await listCloudClustersAllScopes(cloudProvider);
    cloudLoading = false;
    cloudClusters = result.clusters;
    cloudErrors = result.errors;
    if (cloudClusters.length === 0 && cloudErrors.length > 0) {
      error = `All ${cloudErrors.length} scope(s) failed`;
    } else if (cloudClusters.length === 0) {
      error = "No clusters found.";
    }
  }

  async function importCloud(cluster: CloudCluster) {
    clearMessages();
    loading = true;
    const result = await importCloudCluster(cluster);
    if (!result.success) {
      error = result.error ?? "Import failed";
      loading = false;
      return;
    }
    if (result.kubeconfigYaml) {
      await addClustersFromText(result.kubeconfigYaml);
      success = `Imported "${cluster.name}" from ${cluster.provider}.`;
      cloudClusters = cloudClusters.filter((c) => c.name !== cluster.name);
    }
    loading = false;
  }

  // ── Vault ──
  function getVaultPayload() {
    return buildVaultLoginPayload({
      address: vaultAddress.trim(),
      authMethod: vaultAuthMethod,
      secretPath: vaultSecretPath.trim(),
      token: vaultToken.trim() || undefined,
      role: vaultRole.trim() || undefined,
      namespace: vaultNamespace.trim() || undefined,
    });
  }

  // ── Certificate import ──
  async function importCertificate() {
    clearMessages();
    if (
      !certClusterName.trim() ||
      !certServerUrl.trim() ||
      !certClientCert.trim() ||
      !certClientKey.trim()
    ) {
      error = "Fill in all required fields.";
      return;
    }
    loading = true;
    try {
      const caLine = certCaData.trim()
        ? `    certificate-authority-data: ${certCaData.trim()}`
        : `    insecure-skip-tls-verify: true`;
      const yaml = `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: ${certServerUrl.trim()}
${caLine}
  name: ${certClusterName.trim()}
contexts:
- context:
    cluster: ${certClusterName.trim()}
    user: cert-user
  name: ${certClusterName.trim()}
current-context: ${certClusterName.trim()}
users:
- name: cert-user
  user:
    client-certificate-data: ${certClientCert.trim()}
    client-key-data: ${certClientKey.trim()}`;
      await addClustersFromText(yaml);
      success = `Cluster "${certClusterName}" added with X.509 certificate auth.`;
      certClusterName = "";
      certServerUrl = "";
      certCaData = "";
      certClientCert = "";
      certClientKey = "";
    } catch (e) {
      error = (e as Error).message;
    }
    loading = false;
  }

  // ── Token import ──
  async function importToken() {
    clearMessages();
    if (!tokenClusterName.trim() || !tokenServerUrl.trim() || !tokenValue.trim()) {
      error = "Fill in all required fields.";
      return;
    }
    loading = true;
    try {
      const caLine = tokenCaData.trim()
        ? `    certificate-authority-data: ${tokenCaData.trim()}`
        : `    insecure-skip-tls-verify: true`;
      const yaml = `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: ${tokenServerUrl.trim()}
${caLine}
  name: ${tokenClusterName.trim()}
contexts:
- context:
    cluster: ${tokenClusterName.trim()}
    user: token-user
  name: ${tokenClusterName.trim()}
current-context: ${tokenClusterName.trim()}
users:
- name: token-user
  user:
    token: ${tokenValue.trim()}`;
      await addClustersFromText(yaml);
      success = `Cluster "${tokenClusterName}" added with bearer token.`;
      tokenClusterName = "";
      tokenServerUrl = "";
      tokenCaData = "";
      tokenValue = "";
    } catch (e) {
      error = (e as Error).message;
    }
    loading = false;
  }

  // ── Exec-plugin import ──
  async function importExec() {
    clearMessages();
    if (!execClusterName.trim() || !execServerUrl.trim()) {
      error = "Cluster name and API server URL are required.";
      return;
    }
    loading = true;
    try {
      const yaml = generateExecKubeconfig({
        kind: execKind,
        clusterName: execClusterName.trim(),
        serverUrl: execServerUrl.trim(),
        caData: execCaData.trim() || undefined,
        primary: execPrimary.trim() || undefined,
        secondary: execSecondary.trim() || undefined,
        tertiary: execTertiary.trim() || undefined,
        extra: execExtra.trim() || undefined,
        command: execCommand.trim() || undefined,
      });
      await addClustersFromText(yaml);
      success = `Cluster "${execClusterName}" added with ${execPreset.label}. Tokens will be fetched on each API call; nothing is stored.`;
      try {
        localStorage.setItem(STORAGE_EXEC, execKind);
      } catch {
        /* ignore */
      }
      execClusterName = "";
      execServerUrl = "";
      execCaData = "";
      execPrimary = "";
      execSecondary = "";
      execTertiary = "";
      execExtra = "";
      execCommand = "";
    } catch (e) {
      error = (e as Error).message;
    }
    loading = false;
  }

  function restoreExecKind() {
    try {
      const saved = localStorage.getItem(STORAGE_EXEC);
      if (saved && EXEC_PLUGIN_PRESETS.some((p) => p.kind === saved)) {
        execKind = saved as ExecPluginKind;
      }
    } catch {
      /* ignore */
    }
  }

  onMount(() => {
    restoreOidcDefaults();
    restoreExecKind();
    try {
      const saved = localStorage.getItem(STORAGE_METHOD) as ConnectMethod;
      if (saved && METHODS.some((m) => m.id === saved)) {
        method = saved;
        if (saved === "cloud") void loadScopesForProvider();
      }
    } catch {
      /* storage unavailable */
    }
    void runAutoDetect();
  });
</script>

<details
  class="bg-white/70 backdrop-blur-sm border border-slate-200/50 dark:bg-slate-800/60 dark:border-slate-700/60 rounded-xl shadow-sm group"
  open
>
  <summary
    class="flex items-center justify-between cursor-pointer p-4 hover:bg-slate-50/50 dark:hover:bg-slate-700/30 transition rounded-xl"
  >
    <div>
      <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100">Connect Cluster</h2>
      <p class="text-xs text-slate-400 mt-0.5">
        Auto-detect cloud clusters, pick a method, or paste a kubeconfig.
      </p>
    </div>
    <span class="text-slate-400 group-open:rotate-180 transition-transform text-sm">&#9660;</span>
  </summary>
  <div class="px-6 pb-6 pt-2 space-y-4">
    {#if success}
      <div
        class="text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/30 rounded px-3 py-2 flex justify-between items-center"
      >
        <span>{success}</span>
        <button
          class="text-emerald-400 hover:text-white text-[10px]"
          onclick={() => (success = null)}>x</button
        >
      </div>
    {/if}
    {#if error}
      <div
        class="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-2 flex justify-between items-center"
      >
        <span>{error}</span>
        <button class="text-rose-400 hover:text-white text-[10px]" onclick={() => (error = null)}
          >x</button
        >
      </div>
    {/if}

    <!-- ────────── Auto-detect ────────── -->
    {#if $detectedCloudConfigs.length > 0}
      <div
        class="rounded-lg border border-indigo-500/30 bg-indigo-500/5 dark:bg-indigo-500/[0.04] p-3 space-y-2"
      >
        <div class="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p class="text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
              <Cloud size={14} /> Auto-detected from local credentials
            </p>
            <p class="text-[10px] text-slate-500 mt-0.5">
              Scanning {$detectedCloudConfigs.map((c) => c.provider).join(", ")}
              {autoLoading ? "..." : ""}
            </p>
          </div>
          <div class="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              class="text-xs h-7"
              disabled={autoLoading}
              onclick={runAutoDetect}
            >
              {autoLoading ? "Scanning" : autoScanned ? "Rescan" : "Scan"}
            </Button>
            {#if autoClusters.length > 0}
              <Button size="sm" variant="outline" class="text-xs h-7" onclick={toggleAutoSelectAll}>
                {autoSelected.size === autoClusters.length ? "Clear" : "Select all"}
              </Button>
              <Button
                size="sm"
                class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-7"
                disabled={loading || autoSelected.size === 0}
                onclick={importAutoSelected}
              >
                {loading ? "Importing" : `Import ${autoSelected.size || ""}`.trim()}
              </Button>
            {/if}
          </div>
        </div>
        {#if autoClusters.length > 0}
          <div class="space-y-1 max-h-48 overflow-y-auto">
            {#each autoClusters as cluster (autoKey(cluster))}
              {@const key = autoKey(cluster)}
              <label
                class="flex items-center gap-2 rounded border border-slate-700 px-2.5 py-1.5 text-xs hover:border-indigo-500 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={autoSelected.has(key)}
                  onchange={() => toggleAutoSelection(cluster)}
                  class="h-3.5 w-3.5 accent-indigo-500"
                />
                <span class="text-slate-200 font-medium truncate">{cluster.name}</span>
                <span class="text-[10px] text-slate-500">{cluster.region}</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/30 text-indigo-300"
                  >{cluster.provider}</span
                >
                {#if cluster.scope}
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400"
                    >{cluster.scope}</span
                  >
                {/if}
              </label>
            {/each}
          </div>
        {:else if autoScanned && !autoLoading}
          <p class="text-[10px] text-slate-500">
            No clusters returned. Use a method below to add one manually.
          </p>
        {/if}
        {#if autoErrors.length > 0}
          <details class="text-[10px] text-amber-400">
            <summary class="cursor-pointer">
              {autoErrors.length} scope(s) failed during scan
            </summary>
            <div class="space-y-0.5 max-h-24 overflow-y-auto mt-1">
              {#each autoErrors as err, i (`${err.scope}-${i}`)}
                <div class="truncate" title={err.error}>
                  <span class="text-slate-500">{err.scope}:</span>
                  {err.error}
                </div>
              {/each}
            </div>
          </details>
        {/if}
      </div>
    {/if}

    <!-- Method selector -->
    {#if !method}
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {#each METHODS as option (option.id)}
          {@const Icon = option.icon}
          <button
            class="text-left rounded-lg border border-slate-200 dark:border-slate-600 p-3 hover:border-indigo-500 hover:bg-indigo-500/5 transition group"
            onclick={() => selectMethod(option.id)}
          >
            <Icon size={18} class="text-indigo-400" />
            <p
              class="text-xs font-semibold text-slate-700 dark:text-slate-200 mt-1 group-hover:text-indigo-400"
            >
              {option.label}
            </p>
            <p class="text-[10px] text-slate-400 mt-0.5">{option.desc}</p>
            <span
              class="text-[9px] mt-1 inline-block px-1.5 py-0.5 rounded-full cursor-help {option.security ===
              'high'
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-amber-500/10 text-amber-400'}"
              title={option.securityDetail}
            >
              {option.security} security
            </span>
          </button>
        {/each}
      </div>
    {/if}

    <!-- ────────── OIDC (advanced) ────────── -->
    {#if method === "oidc"}
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
            <KeyRound size={14} /> Manual OIDC (advanced)
          </h3>
          <button
            class="text-xs px-2.5 py-1 rounded border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-200 hover:border-slate-400 transition flex items-center gap-1"
            onclick={resetAll}><span class="text-[10px]">&#8592;</span> Back</button
          >
        </div>
        <div
          class="text-[11px] text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded px-3 py-2 leading-relaxed"
        >
          Most users should pick
          <button
            class="underline text-indigo-400 hover:text-indigo-300"
            onclick={() => selectMethod("cloud")}>Cloud Provider</button
          >
          (for AWS/GCP/Azure) or
          <button
            class="underline text-indigo-400 hover:text-indigo-300"
            onclick={() => selectMethod("exec")}>Exec Plugin</button
          >
          first - they handle token rotation automatically. Use this form only if you're manually configuring
          an OIDC issuer and client ID your platform team gave you.
        </div>
        <div class="flex flex-wrap gap-1.5">
          {#each OIDC_PRESETS as p (p.provider)}
            <button
              class="text-[11px] px-2.5 py-1 rounded border transition {oidcProvider === p.provider
                ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                : 'border-slate-600 text-slate-400 hover:border-slate-400'}"
              onclick={() => (oidcProvider = p.provider)}>{p.label}</button
            >
          {/each}
        </div>
        <p class="text-[10px] text-slate-500">
          {oidcPreset.description}
          <a
            href={oidcPreset.docsUrl}
            target="_blank"
            rel="noopener"
            class="text-indigo-400 hover:underline">Docs</a
          >
        </p>
        <div class="grid grid-cols-2 gap-2">
          <input
            type="text"
            bind:value={oidcClusterName}
            placeholder="Cluster name *"
            class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
          />
          <input
            type="text"
            bind:value={oidcServerUrl}
            placeholder="API server URL *"
            class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
          />
          <input
            type="text"
            bind:value={oidcIssuerUrl}
            placeholder={oidcPreset.issuerUrlTemplate + " *"}
            class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
          />
          <input
            type="text"
            bind:value={oidcClientId}
            placeholder="Client ID *"
            class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
          />
          <input
            type="password"
            bind:value={oidcClientSecret}
            placeholder="Client secret (optional)"
            class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
          />
          <input
            type="text"
            bind:value={oidcCaData}
            placeholder="CA cert data (optional)"
            class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
          />
        </div>
        <p class="text-[10px] text-slate-500">
          Requires <code class="bg-slate-700 px-1 rounded">{oidcPreset.execCommand}</code> | Scopes: {oidcPreset.defaultScopes.join(
            ", ",
          )}
        </p>
        <Button
          size="sm"
          class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
          disabled={loading}
          onclick={importOidc}
        >
          {loading ? "Importing" : "Connect via OIDC"}
        </Button>
      </div>
    {/if}

    <!-- ────────── Cloud ────────── -->
    {#if method === "cloud"}
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
            <Cloud size={14} /> Cloud Provider Import
          </h3>
          <button
            class="text-xs px-2.5 py-1 rounded border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-200 hover:border-slate-400 transition flex items-center gap-1"
            onclick={resetAll}><span class="text-[10px]">&#8592;</span> Back</button
          >
        </div>
        <div class="flex flex-wrap gap-2 items-end">
          <div>
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="text-[10px] text-slate-500 block mb-0.5">Provider</label>
            <select
              bind:value={cloudProvider}
              onchange={(e) => {
                const next = (e.currentTarget as HTMLSelectElement).value;
                cloudProvider = next;
                void loadScopesForProvider(next);
              }}
              class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200"
            >
              {#each getSupportedCloudProviders() as p}<option value={p}>{p}</option>{/each}
            </select>
          </div>
          <div>
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="text-[10px] text-slate-500 block mb-0.5">Region (optional)</label>
            <input
              type="text"
              bind:value={cloudRegion}
              placeholder="all regions"
              class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600 w-32"
            />
          </div>
          <div>
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="text-[10px] text-slate-500 block mb-0.5"
              >{cloudScopeLabel} (optional)</label
            >
            {#if cloudScopes.length > 0}
              <select
                bind:value={cloudScope}
                class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200"
              >
                <option value="">default credentials</option>
                {#each cloudScopes as s (s.id)}
                  <option value={s.id}>{s.label}</option>
                {/each}
              </select>
            {:else}
              <input
                type="text"
                bind:value={cloudScope}
                placeholder={cloudScopesLoading
                  ? "loading..."
                  : `${cloudScopeLabel.toLowerCase()} name`}
                class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600 w-36"
              />
            {/if}
          </div>
          <Button
            size="sm"
            variant="outline"
            class="text-xs h-7"
            disabled={cloudLoading}
            onclick={listClouds}
          >
            {cloudLoading ? "Loading" : "List clusters"}
          </Button>
          {#if cloudScopes.length > 0}
            <Button
              size="sm"
              variant="outline"
              class="text-xs h-7"
              disabled={cloudLoading}
              onclick={scanAllScopes}
              title="Scan every {cloudScopeLabel.toLowerCase()} and every region"
            >
              Scan all
            </Button>
          {/if}
        </div>
        {#if cloudClusters.length > 0}
          <div class="space-y-1 max-h-48 overflow-y-auto">
            {#each cloudClusters as cluster (cluster.scope ? `${cluster.scope}::${cluster.region}::${cluster.name}` : `${cluster.region}::${cluster.name}`)}
              <div
                class="flex items-center justify-between gap-2 rounded border border-slate-700 px-2.5 py-1.5 text-xs"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-slate-200 font-medium truncate">{cluster.name}</span>
                  <span class="text-[10px] text-slate-500">{cluster.region}</span>
                  {#if cluster.scope}
                    <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400"
                      >{cluster.scope}</span
                    >
                  {/if}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  class="text-xs h-6 px-2"
                  disabled={loading}
                  onclick={() => importCloud(cluster)}>Import</Button
                >
              </div>
            {/each}
          </div>
        {/if}
        {#if cloudErrors.length > 0}
          <div class="text-[10px] text-amber-400 space-y-0.5 max-h-24 overflow-y-auto">
            <div class="font-semibold">Partial scan - {cloudErrors.length} scope(s) failed:</div>
            {#each cloudErrors as err, i (`${err.scope}-${i}`)}
              <div class="truncate" title={err.error}>
                <span class="text-slate-500">{err.scope}:</span>
                {err.error}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- ────────── Vault ────────── -->
    {#if method === "vault"}
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
            <Vault size={14} /> HashiCorp Vault
          </h3>
          <button
            class="text-xs px-2.5 py-1 rounded border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-200 hover:border-slate-400 transition flex items-center gap-1"
            onclick={resetAll}><span class="text-[10px]">&#8592;</span> Back</button
          >
        </div>
        <div class="grid grid-cols-2 gap-2">
          <input
            type="text"
            bind:value={vaultAddress}
            placeholder="Vault address (https://vault.example.com) *"
            class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600 col-span-2"
          />
          <div>
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="text-[10px] text-slate-500 block mb-0.5">Auth method</label>
            <select
              bind:value={vaultAuthMethod}
              class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 w-full"
            >
              <option value="token">Token</option>
              <option value="kubernetes">Kubernetes</option>
              <option value="oidc">OIDC</option>
              <option value="approle">AppRole</option>
            </select>
          </div>
          <input
            type="password"
            bind:value={vaultToken}
            placeholder={vaultAuthMethod === "token"
              ? "Vault token *"
              : vaultAuthMethod === "approle"
                ? "Secret ID"
                : "JWT token"}
            class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
          />
          <input
            type="text"
            bind:value={vaultSecretPath}
            placeholder="Secret path (secret/data/k8s/prod) *"
            class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
          />
          <input
            type="text"
            bind:value={vaultRole}
            placeholder={vaultAuthMethod === "approle" ? "Role ID" : "Vault role (optional)"}
            class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
          />
          <input
            type="text"
            bind:value={vaultNamespace}
            placeholder="Vault namespace (optional)"
            class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600 col-span-2"
          />
        </div>
        {#if vaultAddress.trim() && vaultSecretPath.trim()}
          {@const payload = getVaultPayload()}
          <div class="rounded border border-slate-700 bg-slate-900/60 p-2 text-[10px] font-mono">
            <p class="text-slate-500 mb-1">API call to retrieve credentials:</p>
            <p class="text-indigo-300">{payload.method} {payload.url}</p>
            {#each Object.entries(payload.headers) as [k, v] (k)}
              <p class="text-slate-500">{k}: {k.includes("Token") ? "***" : v}</p>
            {/each}
          </div>
        {/if}
        <p class="text-[10px] text-slate-500">
          Vault returns kubeconfig or token from the secret path. <a
            href="https://developer.hashicorp.com/vault/docs/secrets/kubernetes"
            target="_blank"
            rel="noopener"
            class="text-indigo-400 hover:underline">Docs</a
          >
        </p>
        <Button
          size="sm"
          class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
          disabled={!vaultAddress.trim() || !vaultSecretPath.trim()}
        >
          Fetch credentials from Vault
        </Button>
      </div>
    {/if}

    <!-- ────────── Certificate ────────── -->
    {#if method === "certificate"}
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
            <FileText size={14} /> X.509 Client Certificate
          </h3>
          <button
            class="text-xs px-2.5 py-1 rounded border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-200 hover:border-slate-400 transition flex items-center gap-1"
            onclick={resetAll}><span class="text-[10px]">&#8592;</span> Back</button
          >
        </div>
        <div class="grid grid-cols-2 gap-2">
          <input
            type="text"
            bind:value={certClusterName}
            placeholder="Cluster name *"
            class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
          />
          <input
            type="text"
            bind:value={certServerUrl}
            placeholder="API server URL *"
            class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
          />
          <textarea
            bind:value={certClientCert}
            placeholder="Client certificate (base64 PEM) *"
            rows="2"
            class="text-xs px-2 py-1 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600 font-mono col-span-2"
          ></textarea>
          <textarea
            bind:value={certClientKey}
            placeholder="Client private key (base64 PEM) *"
            rows="2"
            class="text-xs px-2 py-1 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600 font-mono col-span-2"
          ></textarea>
          <input
            type="text"
            bind:value={certCaData}
            placeholder="CA certificate data (optional)"
            class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600 col-span-2"
          />
        </div>
        <p class="text-[10px] text-slate-500">
          Mutual TLS authentication. Highest security level. <a
            href="https://kubernetes.io/docs/reference/access-authn-authz/authentication/#x509-client-certificates"
            target="_blank"
            rel="noopener"
            class="text-indigo-400 hover:underline">K8s docs</a
          >
        </p>
        <Button
          size="sm"
          class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
          disabled={loading}
          onclick={importCertificate}
        >
          {loading ? "Importing" : "Connect with certificate"}
        </Button>
      </div>
    {/if}

    <!-- ────────── Token ────────── -->
    {#if method === "token"}
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
            <Ticket size={14} /> Bearer Token
          </h3>
          <button
            class="text-xs px-2.5 py-1 rounded border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-200 hover:border-slate-400 transition flex items-center gap-1"
            onclick={resetAll}><span class="text-[10px]">&#8592;</span> Back</button
          >
        </div>
        <div class="grid grid-cols-2 gap-2">
          <input
            type="text"
            bind:value={tokenClusterName}
            placeholder="Cluster name *"
            class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
          />
          <input
            type="text"
            bind:value={tokenServerUrl}
            placeholder="API server URL *"
            class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
          />
          <textarea
            bind:value={tokenValue}
            placeholder="Bearer token or ServiceAccount token *"
            rows="2"
            class="text-xs px-2 py-1 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600 font-mono col-span-2"
          ></textarea>
          <input
            type="text"
            bind:value={tokenCaData}
            placeholder="CA certificate data (optional)"
            class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600 col-span-2"
          />
        </div>
        <div
          class="text-[10px] text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded px-2 py-1"
        >
          Static tokens don't auto-rotate. Consider using OIDC or exec plugins for production.
        </div>
        <Button
          size="sm"
          class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
          disabled={loading}
          onclick={importToken}
        >
          {loading ? "Importing" : "Connect with token"}
        </Button>
      </div>
    {/if}

    <!-- ────────── Exec Plugin ────────── -->
    {#if method === "exec"}
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
            <TerminalSquare size={14} /> Exec Plugin (client-go credential plugin)
          </h3>
          <button
            class="text-xs px-2.5 py-1 rounded border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-200 hover:border-slate-400 transition flex items-center gap-1"
            onclick={resetAll}><span class="text-[10px]">&#8592;</span> Back</button
          >
        </div>
        <div
          class="text-[11px] text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 rounded px-3 py-2 leading-relaxed"
        >
          Recommended by the Kubernetes project. The plugin returns a short-lived token on every API
          call; nothing long-lived is written to disk.
          <a
            href="https://kubernetes.io/docs/reference/access-authn-authz/authentication/#client-go-credential-plugins"
            target="_blank"
            rel="noopener"
            class="underline">k8s docs</a
          >
        </div>
        <div class="flex flex-wrap gap-1.5">
          {#each EXEC_PLUGIN_PRESETS as p (p.kind)}
            <button
              class="text-[11px] px-2.5 py-1 rounded border transition flex items-center gap-1.5 {execKind ===
              p.kind
                ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                : 'border-slate-600 text-slate-400 hover:border-slate-400'}"
              onclick={() => (execKind = p.kind)}
            >
              {p.label}
              {#if p.bundled}
                <span
                  class="text-[9px] px-1 py-0 rounded bg-emerald-500/20 text-emerald-400"
                  title="Binary is bundled with the app">bundled</span
                >
              {/if}
            </button>
          {/each}
        </div>
        <p class="text-[10px] text-slate-500">
          {execPreset.description}
          <a
            href={execPreset.docsUrl}
            target="_blank"
            rel="noopener"
            class="text-indigo-400 hover:underline">Docs</a
          >
        </p>
        <div class="grid grid-cols-2 gap-2">
          <input
            type="text"
            bind:value={execClusterName}
            placeholder="Cluster name *"
            class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
          />
          <input
            type="text"
            bind:value={execServerUrl}
            placeholder="API server URL *"
            class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
          />
          {#if execPreset.primaryLabel}
            <input
              type="text"
              bind:value={execPrimary}
              placeholder={execPreset.primaryLabel}
              class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
            />
          {/if}
          {#if execPreset.secondaryLabel}
            <input
              type="text"
              bind:value={execSecondary}
              placeholder={execPreset.secondaryLabel}
              class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
            />
          {/if}
          {#if execPreset.tertiaryLabel}
            <input
              type="password"
              bind:value={execTertiary}
              placeholder={execPreset.tertiaryLabel}
              class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
            />
          {/if}
          {#if execPreset.extraLabel}
            <input
              type="text"
              bind:value={execExtra}
              placeholder={execPreset.extraLabel}
              class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
            />
          {/if}
          {#if execKind === "generic"}
            <input
              type="text"
              bind:value={execCommand}
              placeholder="Command *"
              class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
            />
          {/if}
          <input
            type="text"
            bind:value={execCaData}
            placeholder="CA cert data (optional)"
            class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600 col-span-2"
          />
        </div>
        {#if !execPreset.bundled}
          <div
            class="text-[10px] text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded px-2 py-1"
          >
            This preset expects the plugin binary to be available in PATH. Install it separately
            before first use.
          </div>
        {/if}
        <Button
          size="sm"
          class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
          disabled={loading}
          onclick={importExec}
        >
          {loading ? "Importing" : "Connect via exec plugin"}
        </Button>
      </div>
    {/if}
  </div>
</details>
