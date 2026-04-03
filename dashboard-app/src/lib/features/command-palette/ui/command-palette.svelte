<script lang="ts">
  import { tick } from "svelte";
  import * as Dialog from "$shared/ui/sheet";
  import { Input } from "$shared/ui/input";
  import { Badge } from "$shared/ui/badge";
  import { pushOverlay } from "$shared/lib/keyboard-manager";
  import { fuzzyFilter } from "../model/fuzzy-search";
  import type { PaletteCommand } from "../model/commands";

  type CommandPaletteProps = {
    open: boolean;
    commands: PaletteCommand[];
    onClose: () => void;
  };

  const { open, commands, onClose }: CommandPaletteProps = $props();

  let query = $state("");
  let selectedIndex = $state(0);
  let paletteEl: HTMLDivElement | null = $state(null);

  const filtered = $derived(fuzzyFilter(commands, query));
  const groups = $derived.by(() => {
    const map = new Map<string, PaletteCommand[]>();
    for (const cmd of filtered) {
      const group = cmd.group;
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(cmd); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    }
    return [...map.entries()];
  });
  const flatFiltered = $derived(groups.flatMap(([, cmds]) => cmds));

  $effect(() => {
    if (!open) return;
    query = "";
    selectedIndex = 0;
    tick().then(() => {
      paletteEl?.querySelector<HTMLInputElement>("input")?.focus();
    });
    const removeOverlay = pushOverlay("command-palette", onClose);
    return () => {
      removeOverlay();
    };
  });

  $effect(() => {
    // Reset selection when filter changes
    void flatFiltered.length;
    selectedIndex = 0;
  });

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (flatFiltered.length > 0) {
        selectedIndex = Math.min(selectedIndex + 1, flatFiltered.length - 1);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const cmd = flatFiltered[selectedIndex];
      if (cmd) {
        onClose();
        cmd.execute();
      }
    }
  }

  function executeCommand(cmd: PaletteCommand) {
    onClose();
    cmd.execute();
  }
</script>

{#if open}
  <Dialog.Root
    {open}
    onOpenChange={(isOpen) => {
      if (!isOpen) onClose();
    }}
  >
    <Dialog.Content
      side="top"
      class="fixed left-1/2 top-[15%] z-[200] w-[90vw] max-w-lg -translate-x-1/2 rounded-xl border bg-popover p-0 shadow-2xl sm:top-[20%]"
    >
      <div
        bind:this={paletteEl}
        class="flex items-center border-b px-3"
        role="combobox"
        aria-expanded="true"
      >
        <Input
          type="text"
          placeholder="Type a command..."
          class="h-12 flex-1 border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
          bind:value={query}
          onkeydown={handleKeydown}
        />
      </div>
      <div class="max-h-[50vh] overflow-y-auto p-1" role="listbox" aria-label="Commands">
        {#if flatFiltered.length === 0}
          <div class="px-3 py-6 text-center text-sm text-muted-foreground">No commands found.</div>
        {:else}
          {#each groups as [group, cmds] (group)}
            <div class="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
              {group}
            </div>
            {#each cmds as cmd (cmd.id)}
              {@const idx = flatFiltered.indexOf(cmd)}
              <button
                type="button"
                role="option"
                aria-selected={idx === selectedIndex}
                class={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition ${
                  idx === selectedIndex
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground hover:bg-muted"
                }`}
                onclick={() => executeCommand(cmd)}
                onmouseenter={() => {
                  selectedIndex = idx;
                }}
              >
                <span class="flex-1 truncate">{cmd.label}</span>
                {#if cmd.shortcut}
                  <Badge variant="outline" class="ml-auto text-[10px]">{cmd.shortcut}</Badge>
                {/if}
              </button>
            {/each}
          {/each}
        {/if}
      </div>
    </Dialog.Content>
  </Dialog.Root>
{/if}
