<script lang="ts">
  import { generateFix, type FixTemplateId, type TemplateParams } from "$shared/lib/fix-templates";
  import { Button } from "$shared/ui/button";

  interface Props {
    templateId: FixTemplateId;
    params: TemplateParams;
    label?: string;
  }

  const { templateId, params, label = "Fix this" }: Props = $props();

  let showYaml = $state(false);
  let copied = $state(false);

  const yaml = $derived(generateFix(templateId, params) ?? "");

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(yaml);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // fallback
    }
  }
</script>

{#if yaml}
  <div class="inline-flex items-center gap-1">
    <Button
      size="sm"
      variant="outline"
      class="text-[10px] h-5 px-1.5 text-amber-500 border-amber-500/30 hover:bg-amber-500/10"
      onclick={() => (showYaml = !showYaml)}
    >
      {showYaml ? "Hide" : label}
    </Button>
  </div>

  {#if showYaml}
    <div class="mt-1.5 rounded border border-slate-600 bg-slate-900/80 p-2 text-[11px] font-mono relative">
      <button
        class="absolute top-1 right-1 text-[9px] px-1.5 py-0.5 rounded border border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 transition"
        onclick={copyToClipboard}
      >{copied ? "Copied!" : "Copy"}</button>
      <pre class="whitespace-pre-wrap text-emerald-300/90 overflow-x-auto">{yaml}</pre>
    </div>
  {/if}
{/if}
