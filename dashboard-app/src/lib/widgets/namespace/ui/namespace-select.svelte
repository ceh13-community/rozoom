<script lang="ts">
  import { onMount } from "svelte";
  import { BookCopy } from "$shared/ui/icons";
  import {
    EMPTY_NAMESPACE_SELECTION,
    namespaces,
    selectedNamespace,
    getSelectedNamespaceList,
    getClusterNamespaces,
    setSelectedNamespace,
    setSelectedNamespaces,
  } from "$features/namespace-management";

  interface Props {
    clusterId: string;
  }

  let { clusterId }: Props = $props();
  let open = $state(false);
  let rootEl = $state<HTMLDivElement | null>(null);
  let selected = $state(new Set<string>());
  let appliedSelectionKey = $state("all");

  const allNamespaces = $derived(($namespaces ?? []).slice().sort((left, right) => left.localeCompare(right)));
  const allSelected = $derived(allNamespaces.length > 0 && selected.size === allNamespaces.length);
  const selectedCount = $derived(selected.size);

  $effect(() => {
    const selectedList = getSelectedNamespaceList($selectedNamespace);
    if (!selectedList) {
      const nextSelection = new Set(allNamespaces);
      selected = nextSelection;
      appliedSelectionKey = getSelectionKey(nextSelection);
      return;
    }
    if (selectedList.length === 0) {
      selected = new Set();
      appliedSelectionKey = "";
      return;
    }
    const available = new Set(allNamespaces);
    const nextSelection = new Set(selectedList.filter((namespace) => available.has(namespace)));
    selected = nextSelection;
    appliedSelectionKey = getSelectionKey(nextSelection);
  });

  function getSelectionKey(next: Set<string>) {
    return allNamespaces.filter((namespace) => next.has(namespace)).join(",");
  }

  function applySelectedNamespaces(next: Set<string>) {
    const values = allNamespaces.filter((namespace) => next.has(namespace));
    if (values.length === 0) {
      setSelectedNamespace(clusterId, EMPTY_NAMESPACE_SELECTION);
      appliedSelectionKey = "";
      return;
    }
    if (values.length === allNamespaces.length) {
      setSelectedNamespace(clusterId, "all");
      appliedSelectionKey = getSelectionKey(next);
      return;
    }
    setSelectedNamespaces(clusterId, values);
    appliedSelectionKey = getSelectionKey(next);
  }

  function toggleNamespace(namespace: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(namespace);
    else next.delete(namespace);
    selected = next;
  }

  function toggleAllNamespaces(checked: boolean) {
    const next = checked ? new Set(allNamespaces) : new Set<string>();
    selected = next;
  }

  function commitSelectionIfNeeded() {
    const nextKey = getSelectionKey(selected);
    if (nextKey === appliedSelectionKey) return;
    applySelectedNamespaces(selected);
  }

  function getSummaryLabel() {
    if (allNamespaces.length === 0) {
      return $selectedNamespace === EMPTY_NAMESPACE_SELECTION
        ? "Namespace: No Namespaces"
        : "Namespace: All Namespaces";
    }
    if (selectedCount === 0) return "Namespace: No Namespaces";
    if (allSelected) return "Namespace: All Namespaces";
    if (selectedCount === 1) return `Namespace: ${allNamespaces.find((namespace) => selected.has(namespace)) ?? "-"}`;
    return `Namespace: ${selectedCount} selected`;
  }

  function closeDropdown() {
    commitSelectionIfNeeded();
    open = false;
  }

  function toggleDropdown() {
    if (open) {
      closeDropdown();
      return;
    }
    open = true;
    void getClusterNamespaces(clusterId);
  }

  onMount(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!open || !rootEl) return;
      const target = event.target as Node | null;
      if (target && !rootEl.contains(target)) {
        closeDropdown();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDropdown();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      commitSelectionIfNeeded();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  });
</script>

{#if $namespaces}
  <div class="relative z-[95] my-2 flex w-full max-w-xl items-center gap-2" bind:this={rootEl}>
    <BookCopy class="h-4 w-4 shrink-0 text-muted-foreground" />
    <button
      class="namespace-select-trigger border-input ring-offset-background data-[placeholder]:text-muted-foreground relative z-[95] flex h-8 min-w-0 w-full items-center justify-between whitespace-nowrap rounded-md border border-border/60 bg-background/50 px-3 py-2 text-sm shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 hover:bg-muted/30"
      aria-haspopup="listbox"
      aria-expanded={open}
      data-state={open ? "open" : "closed"}
      type="button"
      onclick={toggleDropdown}
    >
      {getSummaryLabel()}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="lucide-icon lucide lucide-chevron-down size-4 opacity-50"
      >
        <path d="m6 9 6 6 6-6"></path>
      </svg>
    </button>
    {#if open}
      <div class="absolute left-6 top-9 z-[130] max-h-80 w-[320px] overflow-auto rounded-lg border border-border/60 bg-background/95 p-3 shadow-md">
        <div class="mb-2 flex items-center justify-between border-b border-border/60 pb-2">
          <label class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/30">
            <input
              type="checkbox"
              checked={allSelected}
              onchange={(event) => toggleAllNamespaces(event.currentTarget.checked)}
            />
            <span class="truncate font-medium">All Namespaces</span>
          </label>
        </div>
        {#each allNamespaces as namespace (namespace)}
          <label class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/30">
            <input
              type="checkbox"
              checked={selected.has(namespace)}
              onchange={(event) => toggleNamespace(namespace, event.currentTarget.checked)}
            />
            <span class="truncate">{namespace}</span>
          </label>
        {/each}
      </div>
    {/if}
  </div>
{/if}
