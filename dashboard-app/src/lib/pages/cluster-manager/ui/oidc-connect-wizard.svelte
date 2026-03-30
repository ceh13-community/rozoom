<script lang="ts">
  import {
    OIDC_PRESETS,
    generateOidcKubeconfig,
    type OidcProvider,
  } from "$features/cluster-manager/model/oidc-config";
  import { addClustersFromText } from "$features/cluster-manager";
  import { Button } from "$shared/ui/button";

  let step = $state<1 | 2 | 3>(1);
  let provider = $state<OidcProvider>("generic");
  let clusterName = $state("");
  let serverUrl = $state("");
  let caData = $state("");
  let issuerUrl = $state("");
  let clientId = $state("");
  let clientSecret = $state("");
  let error = $state<string | null>(null);
  let success = $state<string | null>(null);
  let generatedYaml = $state<string | null>(null);

  const preset = $derived(OIDC_PRESETS.find((p) => p.provider === provider)!);
  const canGenerate = $derived(
    clusterName.trim() && serverUrl.trim() && issuerUrl.trim() && clientId.trim(),
  );

  function generate() {
    if (!canGenerate) return;
    generatedYaml = generateOidcKubeconfig(
      clusterName.trim(),
      serverUrl.trim(),
      caData.trim() || null,
      {
        provider,
        issuerUrl: issuerUrl.trim(),
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim() || undefined,
      },
    );
    step = 3;
  }

  async function importGenerated() {
    if (!generatedYaml) return;
    error = null;
    try {
      await addClustersFromText(generatedYaml);
      success = `Cluster "${clusterName}" added with OIDC authentication via ${preset.label}.`;
      step = 1;
      clusterName = "";
      serverUrl = "";
      issuerUrl = "";
      clientId = "";
      clientSecret = "";
      caData = "";
      generatedYaml = null;
    } catch (e) {
      error = (e as Error).message;
    }
  }

  function reset() {
    step = 1;
    error = null;
    success = null;
    generatedYaml = null;
  }
</script>

<div
  class="bg-white/70 backdrop-blur-sm border border-slate-200/50 dark:bg-slate-700 rounded-lg shadow-md p-6"
>
  <h2 class="text-xl font-semibold mb-2 text-gray-800 dark:text-white">Connect via OIDC / SSO</h2>
  <p class="text-gray-600 dark:text-gray-300 mb-4 text-sm">
    Add a cluster using OpenID Connect authentication. Generates kubeconfig with exec-based
    credential plugin.
  </p>

  {#if success}
    <div
      class="text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/30 rounded px-3 py-2 mb-3"
    >
      {success}
    </div>
  {/if}
  {#if error}
    <div
      class="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-2 mb-3"
    >
      {error}
    </div>
  {/if}

  <!-- Step 1: Provider selection -->
  {#if step === 1}
    <div class="space-y-3">
      <div>
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label class="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1"
          >Identity Provider</label
        >
        <div class="flex flex-wrap gap-2">
          {#each OIDC_PRESETS as p (p.provider)}
            <button
              class="text-xs px-3 py-1.5 rounded-lg border transition {provider === p.provider
                ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400 font-semibold'
                : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-slate-400'}"
              onclick={() => (provider = p.provider)}
            >
              {p.label}
            </button>
          {/each}
        </div>
        <p class="text-[10px] text-slate-400 mt-1">{preset.description}</p>
        <a
          href={preset.docsUrl}
          target="_blank"
          rel="noopener"
          class="text-[10px] text-indigo-400 hover:underline">Documentation</a
        >
      </div>

      <Button
        size="sm"
        class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
        onclick={() => (step = 2)}
      >
        Next: Configure connection
      </Button>
    </div>
  {/if}

  <!-- Step 2: Connection details -->
  {#if step === 2}
    <div class="space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1"
            >Cluster Name *</label
          >
          <input
            type="text"
            bind:value={clusterName}
            placeholder="prod-cluster"
            class="w-full h-8 text-xs px-2.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800/50 text-slate-800 dark:text-slate-200"
          />
        </div>
        <div>
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1"
            >API Server URL *</label
          >
          <input
            type="text"
            bind:value={serverUrl}
            placeholder="https://k8s.example.com:6443"
            class="w-full h-8 text-xs px-2.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800/50 text-slate-800 dark:text-slate-200"
          />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1"
            >OIDC Issuer URL *</label
          >
          <input
            type="text"
            bind:value={issuerUrl}
            placeholder={preset.issuerUrlTemplate}
            class="w-full h-8 text-xs px-2.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800/50 text-slate-800 dark:text-slate-200"
          />
        </div>
        <div>
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1"
            >Client ID *</label
          >
          <input
            type="text"
            bind:value={clientId}
            placeholder="kubernetes-client"
            class="w-full h-8 text-xs px-2.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800/50 text-slate-800 dark:text-slate-200"
          />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1"
            >Client Secret (optional)</label
          >
          <input
            type="password"
            bind:value={clientSecret}
            placeholder="leave empty for public clients"
            class="w-full h-8 text-xs px-2.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800/50 text-slate-800 dark:text-slate-200"
          />
        </div>
        <div>
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1"
            >CA Certificate Data (optional)</label
          >
          <input
            type="text"
            bind:value={caData}
            placeholder="base64-encoded CA cert"
            class="w-full h-8 text-xs px-2.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800/50 text-slate-800 dark:text-slate-200"
          />
        </div>
      </div>

      <p class="text-[10px] text-slate-400">
        Requires <code class="bg-slate-100 dark:bg-slate-600 px-1 rounded"
          >{preset.execCommand}</code
        >
        installed. Default scopes: {preset.defaultScopes.join(", ")}
      </p>

      <div class="flex gap-2">
        <Button size="sm" variant="outline" class="text-xs" onclick={() => (step = 1)}>Back</Button>
        <Button
          size="sm"
          class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
          disabled={!canGenerate}
          onclick={generate}
        >
          Generate kubeconfig
        </Button>
      </div>
    </div>
  {/if}

  <!-- Step 3: Review and import -->
  {#if step === 3 && generatedYaml}
    <div class="space-y-3">
      <div
        class="rounded border border-slate-600 bg-slate-900/80 p-3 relative max-h-64 overflow-y-auto"
      >
        <button
          class="absolute top-1.5 right-1.5 text-[9px] px-2 py-0.5 rounded border border-slate-600 text-slate-400 hover:text-white transition"
          onclick={async () => {
            await navigator.clipboard.writeText(generatedYaml ?? "");
          }}>Copy</button
        >
        <pre
          class="text-[10px] font-mono text-emerald-300/80 whitespace-pre-wrap">{generatedYaml}</pre>
      </div>

      <div class="flex gap-2">
        <Button size="sm" variant="outline" class="text-xs" onclick={() => (step = 2)}>Back</Button>
        <Button
          size="sm"
          class="bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
          onclick={importGenerated}
        >
          Import cluster
        </Button>
        <Button size="sm" variant="outline" class="text-xs" onclick={reset}>Cancel</Button>
      </div>
    </div>
  {/if}
</div>
