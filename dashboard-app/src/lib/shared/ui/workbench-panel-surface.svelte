<script lang="ts">
  interface Props {
    tone?: "code" | "muted";
  }

  let { tone = "muted", children }: Props & { children?: import("svelte").Snippet } = $props();

  const toneClass = $derived(
    tone === "code"
      ? "bg-slate-950 font-mono text-xs text-slate-100"
      : "bg-muted/20 text-sm text-muted-foreground",
  );
</script>

<div class={`flex-1 overflow-auto px-4 py-4 ${toneClass}`}>
  {#if children}
    {@render children()}
  {/if}
</div>
