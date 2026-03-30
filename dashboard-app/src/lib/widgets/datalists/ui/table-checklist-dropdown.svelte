<script lang="ts">
  import * as Popover from "$shared/ui/popover";

  type ChecklistEntry = {
    id: string;
    label: string;
    checked: boolean;
    disabled?: boolean;
  };

  interface TableChecklistDropdownProps {
    label: string;
    entries: ChecklistEntry[];
    onToggle: (id: string, checked: boolean) => void;
    onSelectAll?: () => void;
    onClearAll?: () => void;
  }

  const { label, entries, onToggle, onSelectAll, onClearAll }: TableChecklistDropdownProps = $props();

  let open = $state(false);
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    class="h-9 rounded border bg-background px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
    aria-haspopup="menu"
    aria-expanded={open}
  >
    {label}
  </Popover.Trigger>
  {#if open}
    <Popover.Content align="end" sideOffset={6} class="z-[230] w-56 p-2">
      {#if onSelectAll || onClearAll}
        <div class="mb-1 flex items-center justify-between gap-2 border-b pb-1">
          {#if onSelectAll}
            <button
              type="button"
              class="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              onclick={() => onSelectAll?.()}
            >
              All
            </button>
          {/if}
          {#if onClearAll}
            <button
              type="button"
              class="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              onclick={() => onClearAll?.()}
            >
              None
            </button>
          {/if}
        </div>
      {/if}
      {#each entries as entry (entry.id)}
        <label class="flex items-center gap-2 px-2 py-1 text-xs">
          <input
            type="checkbox"
            checked={entry.checked}
            disabled={entry.disabled}
            onchange={(event) => onToggle(entry.id, event.currentTarget.checked)}
          />
          <span class="truncate">{entry.label}</span>
        </label>
      {/each}
    </Popover.Content>
  {/if}
</Popover.Root>
