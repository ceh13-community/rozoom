<script lang="ts">
  type Props = {
    checked: boolean;
    indeterminate?: boolean;
    label: string;
    stopPropagation?: boolean;
    onToggle: (next: boolean) => void;
  };

  const { checked, indeterminate = false, label, stopPropagation = false, onToggle }: Props = $props();

  let inputEl = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (!inputEl) return;
    inputEl.indeterminate = indeterminate;
  });
</script>

<input
  bind:this={inputEl}
  type="checkbox"
  class="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-500"
  aria-label={label}
  aria-checked={indeterminate ? "mixed" : checked}
  checked={checked}
  onclick={(event) => {
    if (stopPropagation) event.stopPropagation();
  }}
  onchange={(event) => {
    onToggle((event.currentTarget as HTMLInputElement).checked);
  }}
/>
