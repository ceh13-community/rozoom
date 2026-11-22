<script lang="ts">
  import type { HTMLTdAttributes } from "svelte/elements";
  import type { WithElementRef } from "bits-ui";
  import { cn } from "$shared";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLTdAttributes> = $props();
</script>

<td
  bind:this={ref}
  class={cn(
    "px-2 py-0.5 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</td>
