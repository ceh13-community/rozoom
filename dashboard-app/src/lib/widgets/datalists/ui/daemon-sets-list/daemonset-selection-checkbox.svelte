<script lang="ts">
  type DaemonSetSelectionCheckboxProps = {
    checked: boolean;
    indeterminate?: boolean;
    label: string;
    onToggle: (next: boolean) => void;
  };

  const { checked, indeterminate = false, label, onToggle }: DaemonSetSelectionCheckboxProps =
    $props();
  let inputElement: HTMLInputElement | null = null;

  $effect(() => {
    if (!inputElement) return;
    inputElement.indeterminate = indeterminate;
  });
</script>

<div class="flex items-center">
  <input
    bind:this={inputElement}
    type="checkbox"
    class="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-500"
    aria-label={label}
    aria-checked={indeterminate ? "mixed" : checked}
    checked={checked}
    onclick={(event) => event.stopPropagation()}
    onchange={(event) => onToggle(event.currentTarget.checked)}
  />
</div>
