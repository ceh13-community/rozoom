<script lang="ts">
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";

  type KeyValueEntry = [string, unknown];
  type Variant = "plain" | "card";

  interface KeyValueExpandProps {
    title: string;
    entries: KeyValueEntry[];
    emptyText?: string;
    contextKey?: string | null;
    variant?: Variant;
  }

  const {
    title,
    entries,
    emptyText = "No entries",
    contextKey = null,
    variant = "plain",
  }: KeyValueExpandProps = $props();

  let isOpen = $state(false);
  let previousContextKey = $state<string | null>(null);

  $effect(() => {
    if (!contextKey || contextKey === previousContextKey) return;
    previousContextKey = contextKey;
    isOpen = false;
  });

  function getButtonClass() {
    if (variant === "card") {
      return `mt-1 inline-flex items-center gap-1 rounded px-1.5 py-1 text-left transition ${
        isOpen
          ? "bg-sky-100/70 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`;
    }
    return "inline-flex w-fit items-center gap-1 rounded px-1.5 py-1 text-left text-muted-foreground transition hover:bg-muted hover:text-foreground";
  }

  function getPanelClass() {
    if (variant === "card") {
      return "mt-2 space-y-1 rounded border border-sky-200/60 bg-sky-50/70 p-2 text-xs dark:border-sky-500/30 dark:bg-sky-500/10";
    }
    return "rounded border bg-muted/20 p-2 text-xs";
  }
</script>

{#if variant === "card"}
  <div class="rounded border p-3">
    <div class="text-xs text-muted-foreground">{title}</div>
    <button type="button" class={getButtonClass()} onclick={() => (isOpen = !isOpen)}>
      <span>{entries.length} {title}</span>
      {#if isOpen}
        <ChevronUp class="h-3.5 w-3.5 text-sky-700 dark:text-sky-300" />
      {:else}
        <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
      {/if}
    </button>
    {#if isOpen}
      <div class={getPanelClass()}>
        {#if entries.length === 0}
          <div class="text-muted-foreground">{emptyText}</div>
        {:else}
          {#each entries as [key, value]}
            <div class="break-all">
              <span class="font-medium">{key}</span>: {String(value)}
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
{:else}
  <button type="button" class={getButtonClass()} onclick={() => (isOpen = !isOpen)}>
    {#if isOpen}
      <ChevronUp class="h-4 w-4" />
    {:else}
      <ChevronDown class="h-4 w-4" />
    {/if}
    {entries.length} {title}
  </button>
  {#if isOpen}
    <div class={getPanelClass()}>
      {#if entries.length === 0}
        <p class="text-muted-foreground">{emptyText}</p>
      {:else}
        {#each entries as [key, value]}
          <p><span class="font-medium">{key}:</span> {String(value)}</p>
        {/each}
      {/if}
    </div>
  {/if}
{/if}
