<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { Snippet } from "svelte";

  interface Props {
    open: boolean;
    onClose: () => void;
    closeAriaLabel?: string;
    maxWidthClass?: string;
    children: Snippet;
  }

  const {
    open,
    onClose,
    closeAriaLabel = "Close details",
    maxWidthClass = "sm:max-w-[50vw]",
    children,
  }: Props = $props();

  let wrapper = $state<HTMLDivElement | null>(null);

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }
</script>

{#if open}
  <div use:portal class="contents">
    <button
      type="button"
      class="fixed inset-0 z-[140] bg-black/20"
      aria-label={closeAriaLabel}
      onclick={onClose}
    ></button>
    <aside class="fixed inset-y-0 right-0 z-[150] w-full border-l bg-background shadow-lg {maxWidthClass}">
      <div class="flex h-full flex-col">
        {@render children()}
      </div>
    </aside>
  </div>
{/if}
