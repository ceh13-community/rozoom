<script lang="ts">
  import Info from "@lucide/svelte/icons/info";
  import DetailsHeaderActions from "./details-header-actions.svelte";

  type DetailsAction = {
    id: string;
    title: string;
    ariaLabel: string;
    icon: any;
    onClick: () => void;
    destructive?: boolean;
  };

  interface DetailsSheetHeaderProps {
    title: string;
    name: string;
    actions?: DetailsAction[];
    onClose: () => void;
    closeAriaLabel: string;
    closeTitle?: string;
    icon?: any;
  }

  const {
    title,
    name,
    actions = [],
    onClose,
    closeAriaLabel,
    closeTitle = "Close",
    icon: Icon = Info,
  }: DetailsSheetHeaderProps = $props();

</script>

<div class="flex items-center justify-between gap-2 border-b px-4 py-3">
  <div class="min-w-0 flex items-center gap-2">
    <Icon class="h-4 w-4 shrink-0 text-muted-foreground" />
    <div class="truncate text-base font-semibold">{title}: {name}</div>
  </div>
  <DetailsHeaderActions {actions} closeAriaLabel={closeAriaLabel} {closeTitle} {onClose} />
</div>
