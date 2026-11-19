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

<!-- A header label never shrinks or truncates: a column is at least as wide as its label
     plus the icon, and a table too wide for the window scrolls instead. The button is
     compact and -ml-1 starts the label where the cell values below it start, so every
     column that is in view also shows its header. -->
<Button class={cn("-ml-1 h-8 justify-start gap-1 px-1", className)} {variant} {...restProps}>
  <span>{label}</span>
  <ArrowUpDownIcon class="shrink-0" />
</Button>
