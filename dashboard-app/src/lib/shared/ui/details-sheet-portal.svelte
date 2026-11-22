<script lang="ts" module>
  let overlaySeq = 0;
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { pushOverlay } from "$shared/lib/keyboard-manager";

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

  // The panel joins the keyboard manager's overlay stack while open, the
  // same layer the command palette uses: Escape closes the topmost overlay
  // only. A bits-ui menu or dialog above the panel handles its own Escape
  // first and the stack leaves that key press alone.
  const overlayId = `details-sheet-${++overlaySeq}`;

  $effect(() => {
    if (!open) return;
    return pushOverlay(overlayId, () => onClose());
  });

  // Text inputs whose type takes typing. Checkboxes, radios and buttons
  // inside the panel keep the plain behaviour: Escape closes the panel.
  const TYPING_INPUT_TYPES = new Set([
    "text",
    "search",
    "email",
    "number",
    "password",
    "tel",
    "url",
  ]);

  function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
    return target instanceof HTMLInputElement && TYPING_INPUT_TYPES.has(target.type);
  }

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

  // Escape in a search box or editor inside the panel leaves the field and
  // keeps the panel open; the next Escape closes it. A direct listener on
  // the panel runs before the window-level keyboard manager, which then
  // sees the key as handled.
  function escapeLeavesField(node: HTMLElement) {
    function onKeydown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (!isTypingTarget(event.target)) return;
      event.preventDefault();
      node.focus({ preventScroll: true });
    }
    node.addEventListener("keydown", onKeydown);
    return {
      destroy() {
        node.removeEventListener("keydown", onKeydown);
      },
    };
  }
</script>

{#if open}
  <div use:portal class="contents">
    <button
      type="button"
      class="fixed inset-0 z-[190] bg-black/80"
      aria-label={closeAriaLabel}
      onclick={onClose}
    ></button>
    <aside
      data-details-panel
      class="fixed inset-y-0 right-0 z-[195] w-full border-l bg-background shadow-lg outline-none {maxWidthClass}"
      tabindex="-1"
      use:focusOnOpen
      use:escapeLeavesField
    >
      <div class="flex h-full flex-col">
        {@render children()}
      </div>
    </aside>
  </div>
{/if}
