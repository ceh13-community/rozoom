<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    leftSlotClass?: string;
    rightSlotClass?: string;
    children?: Snippet;
    actions?: Snippet;
  }

  let {
    leftSlotClass = "flex min-w-[250px] flex-col gap-1",
    rightSlotClass = "flex flex-wrap items-end justify-end gap-2",
    children,
    actions,
  }: Props = $props();
</script>

<div class="flex flex-wrap items-end justify-between gap-3 py-3">
  <div class={leftSlotClass}>
    {#if children}
      {@render children()}
    {/if}
  </div>
  <div class={rightSlotClass}>
    {#if actions}
      {@render actions()}
    {/if}
  </div>
</div>
