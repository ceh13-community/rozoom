<script lang="ts">
  import type { ComponentProps } from "svelte";
  import { cn } from "$shared";
  import { ArrowUpDownIcon } from "$shared/ui/icons";
  import { Button } from "./index";

  let {
    label,
    truncate = false,
    variant = "ghost",
    class: className,
    ...restProps
  }: ComponentProps<typeof Button> & { label: string; truncate?: boolean } = $props();
</script>

<!-- By default a header label never shrinks: in content-sized tables (Deployments) and the
     Pods grid the label's own width keeps the column at least that wide, and a table too
     wide for the window scrolls. -ml-1 starts the label where the cell values start.
     `truncate` is for tables that fix their column widths (table-fixed): there the label
     cannot widen the column, so it is cut with an ellipsis inside its own column instead of
     running into the next header, and the tooltip shows the full name. -->
<Button
  class={cn("-ml-1 h-8 justify-start gap-1 px-1", truncate && "min-w-0 max-w-full", className)}
  title={truncate ? label : undefined}
  {variant}
  {...restProps}
>
  <span class={truncate ? "min-w-0 truncate" : undefined}>{label}</span>
  <ArrowUpDownIcon class="shrink-0" />
</Button>
