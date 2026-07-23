<script lang="ts">
  import { Dialog as SheetPrimitive } from "bits-ui";
  import { cn } from "$shared";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: SheetPrimitive.OverlayProps = $props();
</script>

<SheetPrimitive.Overlay
  bind:ref
  class={cn(
    "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0  fixed inset-0 z-[190] bg-black/80",
    className,
  )}
  {...restProps}
/>
