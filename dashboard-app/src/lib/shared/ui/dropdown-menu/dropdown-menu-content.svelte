<script lang="ts">
  import { cn } from "$shared";
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";

  let {
    ref = $bindable(null),
    class: className,
    sideOffset = 4,
    avoidCollisions = true,
    collisionPadding = 8,
    portalProps,
    ...restProps
  }: DropdownMenuPrimitive.ContentProps & {
    portalProps?: DropdownMenuPrimitive.PortalProps;
  } = $props();
</script>

<DropdownMenuPrimitive.Portal {...portalProps}>
  <DropdownMenuPrimitive.Content
    bind:ref
    {sideOffset}
    {avoidCollisions}
    {collisionPadding}
    class={cn(
      "bg-popover text-popover-foreground z-[220] min-w-[8rem] max-w-[min(24rem,calc(100vw-1rem))] max-h-[var(--bits-dropdown-menu-content-available-height,calc(100dvh-2rem))] overflow-y-auto rounded-md border p-1 shadow-md",
      "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 outline-none",
      className,
    )}
    {...restProps}
  />
</DropdownMenuPrimitive.Portal>
