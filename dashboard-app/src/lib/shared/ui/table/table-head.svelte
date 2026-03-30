<script lang="ts">
  import type { HTMLThAttributes } from "svelte/elements";
  import type { WithElementRef } from "bits-ui";
  import { cn } from "$shared";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLThAttributes> = $props();
</script>

<th
  bind:this={ref}
  class={cn(
    "sticky-table-cell px-2 text-left align-middle font-medium [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</th>
