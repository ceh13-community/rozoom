<script lang="ts">
  // The address an Ingress serves, opened in the system browser, with a copy button.
  import Copy from "@lucide/svelte/icons/copy";
  import { hint } from "$shared/lib/hint";

  interface Props {
    url: string;
    onOpen: (url: string) => void | Promise<void>;
    onCopied: (url: string) => void;
  }

  const { url, onOpen, onCopied }: Props = $props();

  async function copy() {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(url);
    onCopied(url);
  }
</script>

{#if url}
  <div class="flex min-w-0 items-center gap-1">
    <a
      href={url}
      class="truncate text-sky-600 hover:underline dark:text-sky-400"
      data-testid="ingress-url"
      onclick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void onOpen(url);
      }}
      use:hint={{ text: "Open in the browser", placement: "bottom" }}>{url}</a
    >
    <button
      type="button"
      class="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label={`Copy ${url}`}
      onclick={(event) => {
        event.stopPropagation();
        void copy();
      }}
    >
      <Copy class="h-3.5 w-3.5" />
    </button>
  </div>
{:else}
  <span class="text-muted-foreground">-</span>
{/if}
