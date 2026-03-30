<script lang="ts">
  import X from "@lucide/svelte/icons/x";

  type DetailsAction = {
    id: string;
    title: string;
    ariaLabel: string;
    icon: any;
    onClick: () => void;
    destructive?: boolean;
  };

  interface DetailsHeaderActionsProps {
    actions?: DetailsAction[];
    onClose: () => void;
    closeAriaLabel: string;
    closeTitle?: string;
  }

  const {
    actions = [],
    onClose,
    closeAriaLabel,
    closeTitle = "Close",
  }: DetailsHeaderActionsProps = $props();
</script>

<div class="flex shrink-0 items-center gap-1">
  {#each actions as action (action.id)}
    <button
      type="button"
      class={
        action.destructive
          ? "rounded p-1.5 text-destructive hover:bg-destructive/10"
          : "rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      }
      aria-label={action.ariaLabel}
      title={action.title}
      onclick={action.onClick}
    >
      <action.icon class="h-4 w-4" />
    </button>
  {/each}
  <button
    type="button"
    class="rounded bg-rose-100/70 p-1.5 text-xs text-rose-700 transition hover:bg-rose-200 dark:bg-rose-500/20 dark:text-rose-300 dark:hover:bg-rose-500/30"
    aria-label={closeAriaLabel}
    title={closeTitle}
    onclick={onClose}
  >
    <X class="h-4 w-4" />
  </button>
</div>
