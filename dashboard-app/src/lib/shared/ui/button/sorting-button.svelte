<script lang="ts">
  import type { ComponentProps } from "svelte";
  import { cn } from "$shared";
  import { ArrowUpDownIcon } from "$shared/ui/icons";
  import { Button } from "./index";

  let {
    label,
    variant = "ghost",
    class: className,
    ...restProps
  }: ComponentProps<typeof Button> & { label: string } = $props();
</script>

<!-- A header label never runs into the next header. Where the column is at least as wide
     as the label (the Pods grid minimums, the content-sized Deployments table) the label
     shows in full; -ml-1 starts it where the cell values below it start. Where the table
     fixes the column width (table-fixed with percentage widths, as in ConfigMaps, Secrets
     and CRDs) the label is cut with an ellipsis inside its own column and the tooltip
     shows the full name. -->
<Button
  class={cn("-ml-1 h-8 min-w-0 max-w-full justify-start gap-1 px-1", className)}
  title={label}
  {variant}
  {...restProps}
>
  <span class="min-w-0 truncate">{label}</span>
  <ArrowUpDownIcon class="shrink-0" />
</Button>
