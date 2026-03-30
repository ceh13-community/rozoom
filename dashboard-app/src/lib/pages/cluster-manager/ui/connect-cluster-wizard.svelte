<script lang="ts">
  import {
    OIDC_PRESETS,
    generateOidcKubeconfig,
    type OidcProvider,
  } from "$features/cluster-manager/model/oidc-config";
  import {
    buildVaultLoginPayload,
    buildVaultSecretReadPayload,
    type VaultAuthMethod,
  } from "$features/cluster-manager/model/vault-integration";
  import {
    listCloudClusters,
    importCloudCluster,
    getSupportedCloudProviders,
    type CloudCluster,
  } from "$features/cluster-manager/api/cloud-import";
  import { addClustersFromText } from "$features/cluster-manager";
  import { Button } from "$shared/ui/button";

  type ConnectMethod = "oidc" | "cloud" | "vault" | "certificate" | "token" | null;

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
  let cloudClusters = $state<CloudCluster[]>([]);
  let cloudLoading = $state(false);

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

  const oidcPreset = $derived(OIDC_PRESETS.find((p) => p.provider === oidcProvider)!);

  function clearMessages() { error = null; success = null; }

  function resetAll() {
    method = null;
    error = null;
    success = null;
    loading = false;
  }

  // ── OIDC import ──
  async function importOidc() {
    clearMessages();
    if (!oidcClusterName.trim() || !oidcServerUrl.trim() || !oidcIssuerUrl.trim() || !oidcClientId.trim()) {
      error = "Fill in all required fields."; return;
    }
    loading = true;
    try {
      const yaml = generateOidcKubeconfig(
        oidcClusterName.trim(), oidcServerUrl.trim(), oidcCaData.trim() || null,
        { provider: oidcProvider, issuerUrl: oidcIssuerUrl.trim(), clientId: oidcClientId.trim(), clientSecret: oidcClientSecret.trim() || undefined },
      );
      await addClustersFromText(yaml);
      success = `Cluster "${oidcClusterName}" added with ${oidcPreset.label} OIDC.`;
      oidcClusterName = ""; oidcServerUrl = ""; oidcIssuerUrl = ""; oidcClientId = ""; oidcClientSecret = ""; oidcCaData = "";
    } catch (e) { error = (e as Error).message; }
    loading = false;
  }

  // ── Cloud import ──
  async function listClouds() {
    clearMessages();
    cloudLoading = true;
    cloudClusters = [];
    const result = await listCloudClusters(cloudProvider, cloudRegion.trim() || undefined);
    cloudLoading = false;
    if (result.error) { error = result.error; return; }
    cloudClusters = result.clusters;
    if (cloudClusters.length === 0) error = "No clusters found.";
  }

  async function importCloud(cluster: CloudCluster) {
    clearMessages();
    loading = true;
    const result = await importCloudCluster(cluster);
    if (!result.success) { error = result.error ?? "Import failed"; loading = false; return; }
    if (result.kubeconfigYaml) {
      await addClustersFromText(result.kubeconfigYaml);
      success = `Imported "${cluster.name}" from ${cluster.provider}.`;
      cloudClusters = cloudClusters.filter((c) => c.name !== cluster.name);
    }
    loading = false;
  }

  // ── Vault (shows connection info for now) ──
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
    if (!certClusterName.trim() || !certServerUrl.trim() || !certClientCert.trim() || !certClientKey.trim()) {
      error = "Fill in all required fields."; return;
    }
    loading = true;
    try {
      const caLine = certCaData.trim() ? `    certificate-authority-data: ${certCaData.trim()}` : `    insecure-skip-tls-verify: true`;
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
      certClusterName = ""; certServerUrl = ""; certCaData = ""; certClientCert = ""; certClientKey = "";
    } catch (e) { error = (e as Error).message; }
    loading = false;
  }

  // ── Token import ──
  async function importToken() {
    clearMessages();
    if (!tokenClusterName.trim() || !tokenServerUrl.trim() || !tokenValue.trim()) {
      error = "Fill in all required fields."; return;
    }
    loading = true;
    try {
      const caLine = tokenCaData.trim() ? `    certificate-authority-data: ${tokenCaData.trim()}` : `    insecure-skip-tls-verify: true`;
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
      tokenClusterName = ""; tokenServerUrl = ""; tokenCaData = ""; tokenValue = "";
    } catch (e) { error = (e as Error).message; }
    loading = false;
  }
</script>

<details class="bg-white/70 backdrop-blur-sm border border-slate-200/50 dark:bg-slate-800/60 dark:border-slate-700/60 rounded-xl shadow-sm group">
  <summary class="flex items-center justify-between cursor-pointer p-4 hover:bg-slate-50/50 dark:hover:bg-slate-700/30 transition rounded-xl">
    <div>
      <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100">Connect Cluster</h2>
      <p class="text-xs text-slate-400 mt-0.5">OIDC / SSO, Cloud Provider, Vault, Certificate, Token</p>
    </div>
    <span class="text-slate-400 group-open:rotate-180 transition-transform text-sm">&#9660;</span>
  </summary>
  <div class="px-6 pb-6 pt-2">

  {#if success}
    <div class="text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/30 rounded px-3 py-2 mb-3 flex justify-between items-center">
      <span>{success}</span>
      <button class="text-emerald-400 hover:text-white text-[10px]" onclick={() => (success = null)}>x</button>
    </div>
  {/if}
  {#if error}
    <div class="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-2 mb-3 flex justify-between items-center">
      <span>{error}</span>
      <button class="text-rose-400 hover:text-white text-[10px]" onclick={() => (error = null)}>x</button>
    </div>
  {/if}

  <!-- Method selector -->
  {#if !method}
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      {#each [
        { id: "oidc", label: "OIDC / SSO", desc: "Azure AD, Okta, Keycloak, Google", icon: "🔐", security: "high" },
        { id: "cloud", label: "Cloud Provider", desc: "AWS EKS, GKE, AKS (one-click)", icon: "☁️", security: "high" },
        { id: "vault", label: "HashiCorp Vault", desc: "Dynamic credentials from Vault", icon: "🏦", security: "high" },
        { id: "certificate", label: "X.509 Certificate", desc: "Client cert + key (mTLS)", icon: "📜", security: "high" },
        { id: "token", label: "Bearer Token", desc: "Static or service account token", icon: "🎫", security: "medium" },
      ] as option (option.id)}
        <button
          class="text-left rounded-lg border border-slate-200 dark:border-slate-600 p-3 hover:border-indigo-500 hover:bg-indigo-500/5 transition group"
          onclick={() => { method = option.id as ConnectMethod; clearMessages(); }}
        >
          <span class="text-lg">{option.icon}</span>
          <p class="text-xs font-semibold text-slate-700 dark:text-slate-200 mt-1 group-hover:text-indigo-400">{option.label}</p>
          <p class="text-[10px] text-slate-400 mt-0.5">{option.desc}</p>
          <span class="text-[9px] mt-1 inline-block px-1.5 py-0.5 rounded-full {option.security === 'high' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}">
            {option.security} security
          </span>
        </button>
      {/each}
    </div>
  {/if}

  <!-- ────────── OIDC ────────── -->
  {#if method === "oidc"}
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-slate-200">OIDC / SSO Authentication</h3>
        <button class="text-xs px-2.5 py-1 rounded border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-200 hover:border-slate-400 transition flex items-center gap-1" onclick={resetAll}><span class="text-[10px]">&#8592;</span> Back</button>
      </div>
      <div class="flex flex-wrap gap-1.5">
        {#each OIDC_PRESETS as p (p.provider)}
          <button
            class="text-[11px] px-2.5 py-1 rounded border transition {oidcProvider === p.provider ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300' : 'border-slate-600 text-slate-400 hover:border-slate-400'}"
            onclick={() => (oidcProvider = p.provider)}
          >{p.label}</button>
        {/each}
      </div>
      <p class="text-[10px] text-slate-500">{oidcPreset.description} <a href={oidcPreset.docsUrl} target="_blank" rel="noopener" class="text-indigo-400 hover:underline">Docs</a></p>
      <div class="grid grid-cols-2 gap-2">
        <input type="text" bind:value={oidcClusterName} placeholder="Cluster name *" class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600" />
        <input type="text" bind:value={oidcServerUrl} placeholder="API server URL *" class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600" />
        <input type="text" bind:value={oidcIssuerUrl} placeholder={oidcPreset.issuerUrlTemplate + " *"} class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600" />
        <input type="text" bind:value={oidcClientId} placeholder="Client ID *" class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600" />
        <input type="password" bind:value={oidcClientSecret} placeholder="Client secret (optional)" class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600" />
        <input type="text" bind:value={oidcCaData} placeholder="CA cert data (optional)" class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600" />
      </div>
      <p class="text-[10px] text-slate-500">Requires <code class="bg-slate-700 px-1 rounded">{oidcPreset.execCommand}</code> | Scopes: {oidcPreset.defaultScopes.join(", ")}</p>
      <Button size="sm" class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs" disabled={loading} onclick={importOidc}>
        {loading ? "Importing" : "Connect via OIDC"}
      </Button>
    </div>
  {/if}

  <!-- ────────── Cloud ────────── -->
  {#if method === "cloud"}
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-slate-200">Cloud Provider Import</h3>
        <button class="text-xs px-2.5 py-1 rounded border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-200 hover:border-slate-400 transition flex items-center gap-1" onclick={resetAll}><span class="text-[10px]">&#8592;</span> Back</button>
      </div>
      <div class="flex gap-2 items-end">
        <div>
          <label class="text-[10px] text-slate-500 block mb-0.5">Provider</label>
          <select bind:value={cloudProvider} class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200">
            {#each getSupportedCloudProviders() as p}<option value={p}>{p}</option>{/each}
          </select>
        </div>
        <div>
          <label class="text-[10px] text-slate-500 block mb-0.5">Region (optional)</label>
          <input type="text" bind:value={cloudRegion} placeholder="us-east-1" class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600 w-32" />
        </div>
        <Button size="sm" variant="outline" class="text-xs h-7" disabled={cloudLoading} onclick={listClouds}>
          {cloudLoading ? "Loading" : "List clusters"}
        </Button>
      </div>
      {#if cloudClusters.length > 0}
        <div class="space-y-1 max-h-48 overflow-y-auto">
          {#each cloudClusters as cluster (cluster.name)}
            <div class="flex items-center justify-between gap-2 rounded border border-slate-700 px-2.5 py-1.5 text-xs">
              <div class="flex items-center gap-2 min-w-0">
                <span class="text-slate-200 font-medium truncate">{cluster.name}</span>
                <span class="text-[10px] text-slate-500">{cluster.region}</span>
              </div>
              <Button size="sm" variant="outline" class="text-xs h-6 px-2" disabled={loading} onclick={() => importCloud(cluster)}>Import</Button>
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
        <h3 class="text-sm font-semibold text-slate-200">HashiCorp Vault</h3>
        <button class="text-xs px-2.5 py-1 rounded border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-200 hover:border-slate-400 transition flex items-center gap-1" onclick={resetAll}><span class="text-[10px]">&#8592;</span> Back</button>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <input type="text" bind:value={vaultAddress} placeholder="Vault address (https://vault.example.com) *" class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600 col-span-2" />
        <div>
          <label class="text-[10px] text-slate-500 block mb-0.5">Auth method</label>
          <select bind:value={vaultAuthMethod} class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 w-full">
            <option value="token">Token</option>
            <option value="kubernetes">Kubernetes</option>
            <option value="oidc">OIDC</option>
            <option value="approle">AppRole</option>
          </select>
        </div>
        <input type="password" bind:value={vaultToken} placeholder={vaultAuthMethod === "token" ? "Vault token *" : vaultAuthMethod === "approle" ? "Secret ID" : "JWT token"} class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600" />
        <input type="text" bind:value={vaultSecretPath} placeholder="Secret path (secret/data/k8s/prod) *" class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600" />
        <input type="text" bind:value={vaultRole} placeholder={vaultAuthMethod === "approle" ? "Role ID" : "Vault role (optional)"} class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600" />
        <input type="text" bind:value={vaultNamespace} placeholder="Vault namespace (optional)" class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600 col-span-2" />
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
      <p class="text-[10px] text-slate-500">Vault returns kubeconfig or token from the secret path. <a href="https://developer.hashicorp.com/vault/docs/secrets/kubernetes" target="_blank" rel="noopener" class="text-indigo-400 hover:underline">Docs</a></p>
      <Button size="sm" class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs" disabled={!vaultAddress.trim() || !vaultSecretPath.trim()}>
        Fetch credentials from Vault
      </Button>
    </div>
  {/if}

  <!-- ────────── Certificate ────────── -->
  {#if method === "certificate"}
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-slate-200">X.509 Client Certificate</h3>
        <button class="text-xs px-2.5 py-1 rounded border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-200 hover:border-slate-400 transition flex items-center gap-1" onclick={resetAll}><span class="text-[10px]">&#8592;</span> Back</button>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <input type="text" bind:value={certClusterName} placeholder="Cluster name *" class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600" />
        <input type="text" bind:value={certServerUrl} placeholder="API server URL *" class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600" />
        <textarea bind:value={certClientCert} placeholder="Client certificate (base64 PEM) *" rows="2" class="text-xs px-2 py-1 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600 font-mono col-span-2"></textarea>
        <textarea bind:value={certClientKey} placeholder="Client private key (base64 PEM) *" rows="2" class="text-xs px-2 py-1 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600 font-mono col-span-2"></textarea>
        <input type="text" bind:value={certCaData} placeholder="CA certificate data (optional)" class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600 col-span-2" />
      </div>
      <p class="text-[10px] text-slate-500">Mutual TLS authentication. Highest security level. <a href="https://kubernetes.io/docs/reference/access-authn-authz/authentication/#x509-client-certificates" target="_blank" rel="noopener" class="text-indigo-400 hover:underline">K8s docs</a></p>
      <Button size="sm" class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs" disabled={loading} onclick={importCertificate}>
        {loading ? "Importing" : "Connect with certificate"}
      </Button>
    </div>
  {/if}

  <!-- ────────── Token ────────── -->
  {#if method === "token"}
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-slate-200">Bearer Token</h3>
        <button class="text-xs px-2.5 py-1 rounded border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-200 hover:border-slate-400 transition flex items-center gap-1" onclick={resetAll}><span class="text-[10px]">&#8592;</span> Back</button>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <input type="text" bind:value={tokenClusterName} placeholder="Cluster name *" class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600" />
        <input type="text" bind:value={tokenServerUrl} placeholder="API server URL *" class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600" />
        <textarea bind:value={tokenValue} placeholder="Bearer token or ServiceAccount token *" rows="2" class="text-xs px-2 py-1 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600 font-mono col-span-2"></textarea>
        <input type="text" bind:value={tokenCaData} placeholder="CA certificate data (optional)" class="h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600 col-span-2" />
      </div>
      <div class="text-[10px] text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded px-2 py-1">
        Static tokens don't auto-rotate. Consider using OIDC or exec plugins for production.
      </div>
      <Button size="sm" class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs" disabled={loading} onclick={importToken}>
        {loading ? "Importing" : "Connect with token"}
      </Button>
    </div>
  {/if}
  </div>
</details>
