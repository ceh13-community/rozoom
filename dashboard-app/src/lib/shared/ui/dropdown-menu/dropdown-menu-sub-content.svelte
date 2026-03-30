<script lang="ts">
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import { cn } from "$shared";

  let {
    ref = $bindable(null),
    class: className,
    avoidCollisions = true,
    collisionPadding = 8,
    ...restProps
  }: DropdownMenuPrimitive.SubContentProps = $props();
</script>

<DropdownMenuPrimitive.SubContent
  bind:ref
  {avoidCollisions}
  {collisionPadding}
  class={cn(
    "bg-popover text-popover-foreground z-[220] min-w-[8rem] max-h-[var(--bits-dropdown-menu-content-available-height,calc(100dvh-2rem))] overflow-y-auto rounded-md border p-1 shadow-lg focus:outline-none",
    className,
  )}
  {...restProps}
/>
