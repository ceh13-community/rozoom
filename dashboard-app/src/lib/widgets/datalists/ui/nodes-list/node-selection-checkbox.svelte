<script lang="ts">
  type NodeSelectionCheckboxProps = {
    checked: boolean;
    indeterminate?: boolean;
    label: string;
    onToggle: (next: boolean) => void;
  };

  const { checked, indeterminate = false, label, onToggle }: NodeSelectionCheckboxProps = $props();
  let inputElement: HTMLInputElement | null = null;

  $effect(() => {
    if (!inputElement) return;
    inputElement.indeterminate = indeterminate;
  });
</script>

<!-- 24 px click target around the 16 px box; a click on the margin does not open details. -->
<!-- The checkbox inside takes the keyboard; the label only stops the row click. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<label
  class="-m-1 flex cursor-pointer items-center p-1"
  onclick={(event) => event.stopPropagation()}
>
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
</label>
