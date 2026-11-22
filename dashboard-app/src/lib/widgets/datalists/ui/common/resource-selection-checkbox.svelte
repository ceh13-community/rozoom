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

<!-- 24 px click target around the 16 px box. -->
<!-- The checkbox inside takes the keyboard; the label only stops the row click. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<label
  class="-m-1 inline-flex cursor-pointer items-center p-1"
  onclick={(event) => {
    if (stopPropagation) event.stopPropagation();
  }}
>
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
</label>
