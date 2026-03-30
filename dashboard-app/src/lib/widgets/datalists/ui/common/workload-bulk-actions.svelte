<script lang="ts">
  import { Button } from "$shared/ui/button";

  type WorkloadActionMode = "single" | "multi";

  export type WorkloadBulkActionItem = {
    id: string;
    icon: any;
    onClick: () => void;
    label: string;
    title: string;
    showInModes?: WorkloadActionMode[];
    destructive?: boolean;
    disabled?: boolean;
  };

  type WorkloadBulkActionsProps = {
    mode: WorkloadActionMode;
    disabled?: boolean;
    items: WorkloadBulkActionItem[];
  };

  const { mode, disabled = true, items }: WorkloadBulkActionsProps = $props();

  function shouldRender(item: WorkloadBulkActionItem) {
    if (!item.showInModes || item.showInModes.length === 0) return true;
    return item.showInModes.includes(mode);
  }
</script>

<div class="flex items-center gap-1">
  {#each items as item (item.id)}
    {#if shouldRender(item)}
      <Button
        variant="ghost"
        size="icon"
        aria-label={item.label}
        title={item.title}
        disabled={disabled || Boolean(item.disabled)}
        class={item.destructive ? "text-destructive hover:text-destructive" : ""}
        onclick={item.onClick}
      >
        <item.icon class="h-4 w-4" />
      </Button>
    {/if}
  {/each}
</div>
