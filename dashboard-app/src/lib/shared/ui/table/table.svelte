<script lang="ts">
  import type { HTMLTableAttributes } from "svelte/elements";
  import type { WithElementRef } from "bits-ui";
  import { cn } from "$shared";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLTableAttributes> = $props();
</script>

<div class="relative w-full overflow-visible">
  <table bind:this={ref} class={cn("w-full caption-bottom text-sm", className)} {...restProps}>
    {@render children?.()}
  </table>
</div>
