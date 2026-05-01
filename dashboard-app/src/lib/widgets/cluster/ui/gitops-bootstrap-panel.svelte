<script lang="ts">
  import {
    getBootstrapSteps,
    generateArgoCDAppYaml,
    generateFluxGitRepositoryYaml,
    generateFluxKustomizationYaml,
    type GitOpsProvider,
    type GitOpsBootstrapConfig,
  } from "$shared/lib/gitops-bootstrap";
  import { Button } from "$shared/ui/button";

  interface Props {
    clusterId: string;
  }

  const { clusterId }: Props = $props();

  let provider = $state<GitOpsProvider>("argocd");
  let repoUrl = $state("");
  let branch = $state("main");
  let path = $state(".");
  let showSteps = $state(false);
  let copied = $state<string | null>(null);

  const config = $derived<GitOpsBootstrapConfig>({
    provider,
    repoUrl: repoUrl.trim() || "https://github.com/org/infra.git",
    branch: branch.trim() || "main",
    path: path.trim() || ".",
  });

  const steps = $derived(getBootstrapSteps(config));

  const generatedYaml = $derived.by(() => {
    if (provider === "argocd") return generateArgoCDAppYaml(config);
    return `${generateFluxGitRepositoryYaml(config)}\n---\n${generateFluxKustomizationYaml(config)}`;
  });

  async function copyYaml(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = id;
      setTimeout(() => (copied = null), 2000);
    } catch {
      /* */
    }
  }
</script>

<div class="rounded-lg border border-slate-700 bg-slate-800/60 p-4 space-y-3">
  <h3 class="text-sm font-semibold text-slate-200">GitOps Bootstrap</h3>
  <p class="text-[10px] text-slate-500 mt-0.5 mb-2">
    Set up ArgoCD or Flux for declarative GitOps. Generates Application/GitRepository +
    Kustomization YAML with automated sync and self-heal.
  </p>

  <div class="flex gap-2">
    <button
      class="text-xs px-3 py-1 rounded border transition {provider === 'argocd'
        ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
        : 'border-slate-600 text-slate-400 hover:border-slate-400'}"
      onclick={() => (provider = "argocd")}>ArgoCD</button
    >
    <button
      class="text-xs px-3 py-1 rounded border transition {provider === 'flux'
        ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
        : 'border-slate-600 text-slate-400 hover:border-slate-400'}"
      onclick={() => (provider = "flux")}>Flux</button
    >
  </div>

  <div class="grid grid-cols-3 gap-2">
    <div>
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="text-[10px] text-slate-500 block mb-0.5">Git Repository URL</label>
      <input
        type="text"
        bind:value={repoUrl}
        placeholder="https://github.com/org/infra.git"
        class="w-full h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
      />
    </div>
    <div>
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="text-[10px] text-slate-500 block mb-0.5">Branch</label>
      <input
        type="text"
        bind:value={branch}
        placeholder="main"
        class="w-full h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
      />
    </div>
    <div>
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="text-[10px] text-slate-500 block mb-0.5">Path</label>
      <input
        type="text"
        bind:value={path}
        placeholder="."
        class="w-full h-7 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
      />
    </div>
  </div>

  <Button size="sm" variant="outline" class="text-xs" onclick={() => (showSteps = !showSteps)}>
    {showSteps ? "Hide" : "Show"} bootstrap steps ({steps.length})
  </Button>

  {#if showSteps}
    <div class="space-y-2">
      {#each steps as step, i (step.id)}
        <div class="rounded border border-slate-700 bg-slate-900/50 p-2">
          <div class="flex items-center gap-2 text-xs">
            <span
              class="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[10px] font-bold shrink-0"
              >{i + 1}</span
            >
            <span class="text-slate-300">{step.label}</span>
          </div>
          <code class="block mt-1 text-[10px] text-slate-500 font-mono"
            >{step.command.join(" ")}</code
          >
        </div>
      {/each}

      <div class="rounded border border-slate-700 bg-slate-900/80 p-2 relative">
        <div class="flex items-center justify-between mb-1">
          <span class="text-[10px] text-slate-500"
            >Generated {provider === "argocd" ? "Application" : "GitRepository + Kustomization"} YAML</span
          >
          <button
            class="text-[9px] px-1.5 py-0.5 rounded border border-slate-600 text-slate-400 hover:text-white transition"
            onclick={() => copyYaml(generatedYaml, "yaml")}
            >{copied === "yaml" ? "Copied!" : "Copy"}</button
          >
        </div>
        <pre
          class="text-[10px] font-mono text-emerald-300/80 whitespace-pre-wrap overflow-x-auto max-h-48">{generatedYaml}</pre>
      </div>
    </div>
  {/if}
</div>
