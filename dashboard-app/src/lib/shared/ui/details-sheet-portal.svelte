<script lang="ts">
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

  // Escape from a dialog, menu, listbox or combobox outside the panel belongs
  // to that overlay (a delete confirmation, a row menu, the command palette).
  const OTHER_OVERLAY =
    '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="combobox"]';

  let panel = $state<HTMLElement | null>(null);

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  // Focus lands in the panel, so Escape and Tab work without a click first.
  // Deferred: the portal moves the panel into <body> after this runs.
  function focusOnOpen(node: HTMLElement) {
    queueMicrotask(() => node.focus({ preventScroll: true }));
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!open || event.key !== "Escape" || event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    const overlay = target?.closest(OTHER_OVERLAY);
    if (overlay && !panel?.contains(overlay)) return;
    onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div use:portal class="contents">
    <button
      type="button"
      class="fixed inset-0 z-[190] bg-black/80"
      aria-label={closeAriaLabel}
      onclick={onClose}
    ></button>
    <aside
      class="fixed inset-y-0 right-0 z-[195] w-full border-l bg-background shadow-lg outline-none {maxWidthClass}"
      tabindex="-1"
      bind:this={panel}
      use:focusOnOpen
    >
      <div class="flex h-full flex-col">
        {@render children()}
      </div>
    </aside>
  </div>
{/if}
