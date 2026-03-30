<script lang="ts">
  import { Button } from "$shared/ui/button";
  import { Input } from "$shared/ui/input";
  import { BookCopy } from "$shared/ui/icons";
  import * as Popover from "$shared/ui/popover";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";

  const { namespaces }: { namespaces?: string[] } = $props();
  const maxVisible = 8;
  let filterQuery = $state("");
  let copyStatus = $state<"idle" | "copied" | "error">("idle");
  let isOpen = $state(false);

  const normalizedNamespaces = $derived(namespaces ?? []);
  const filteredNamespaces = $derived.by(() => {
    if (!filterQuery.trim()) return normalizedNamespaces;

    const query = filterQuery.toLowerCase();
    return normalizedNamespaces.filter((ns) => ns.toLowerCase().includes(query));
  });
  const visibleNamespaces = $derived.by(() => filteredNamespaces.slice(0, maxVisible));
  const remainingCount = $derived.by(() => Math.max(filteredNamespaces.length - maxVisible, 0));

  async function copyNamespaces() {
    if (!filteredNamespaces.length) return;

    try {
      await navigator.clipboard.writeText(filteredNamespaces.join("\n"));
      copyStatus = "copied";
    } catch {
      copyStatus = "error";
    }

    window.setTimeout(() => {
      copyStatus = "idle";
    }, 2000);
  }
</script>

<div class="mb-1 flex items-center justify-between gap-2 px-1 text-sm">
  <span class="font-medium text-foreground">Namespaces</span>
  <Popover.Root bind:open={isOpen}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <button
          {...props}
          type="button"
          class="inline-flex items-center rounded-md border border-border/60 bg-background/40 px-2.5 py-1 text-sm text-foreground transition-colors hover:bg-muted/40"
        >
          {normalizedNamespaces.length}
        </button>
      {/snippet}
    </Popover.Trigger>

    <Popover.Content class="w-96 rounded-lg border border-border/60 bg-background/95 p-3 shadow-md">
      <div class="mb-2 flex items-center gap-2">
        <Input
          type="search"
          placeholder="Filter namespaces..."
          class="h-8"
          bind:value={filterQuery}
        />
        <Button
          variant="outline"
          size="sm"
          class="h-8 px-2"
          onclick={copyNamespaces}
          disabled={!filteredNamespaces.length}
        >
          <BookCopy class="w-4 h-4 mr-1" />
          {#if copyStatus === "copied"}
            Copied
          {:else if copyStatus === "error"}
            Error
          {:else}
            Copy
          {/if}
        </Button>
      </div>
      <div class="mb-2 text-xs text-muted-foreground">
        {filteredNamespaces.length} of {normalizedNamespaces.length} namespaces
      </div>
      <div class="max-h-48 space-y-1 overflow-auto text-sm">
        {#if filteredNamespaces.length === 0}
          <TableEmptyState message="No results for the current filter." />
        {:else}
          {#each visibleNamespaces as ns}
            <div class="rounded-md px-2 py-1.5 text-foreground hover:bg-muted/30">{ns}</div>
          {/each}
          {#if remainingCount > 0}
            <div class="px-2 py-1 text-xs text-muted-foreground">+{remainingCount} more…</div>
          {/if}
        {/if}
      </div>
    </Popover.Content>
  </Popover.Root>
</div>
