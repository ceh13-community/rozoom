<script lang="ts">
  import { Input } from "$shared/ui/input";
  import TableSummaryBar from "$shared/ui/table-summary-bar.svelte";

  type SummaryItem = {
    label: string;
    value: string | number;
  };

  interface Props {
    items: SummaryItem[];
    value: string;
    placeholder: string;
    querySlotClass?: string;
    onInput: (value: string) => void;
  }

  let { items, value, placeholder, querySlotClass, onInput }: Props = $props();
</script>

<TableSummaryBar {items} {querySlotClass}>
  {#snippet children()}
    <Input
      {value}
      {placeholder}
      data-shortcut-target="workload-search"
      oninput={(event) => {
        onInput((event.currentTarget as HTMLInputElement).value);
      }}
    />
  {/snippet}
</TableSummaryBar>
