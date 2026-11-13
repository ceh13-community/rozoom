<script lang="ts">
  import type { Snippet } from "svelte";
  import { page } from "$app/state";
  import { reportJsError, describeError } from "$shared/lib/js-error-log";
  import { redactSecrets } from "$shared/lib/log-redaction";
  import {
    buildSupportReport,
    copyToClipboard,
    readRecentLogTail,
  } from "$shared/lib/support-diagnostics";

  // Catches a render or effect error inside the page area so the page shows what broke
  // instead of an empty dark pane, and writes it to logs.log. The sidebar stays usable;
  // navigating remounts the page (routeRemountKey in the dashboard layout) and clears it.
  let { children }: { children: Snippet } = $props();

  const appVersion: string = __APP_VERSION__;
  let copyState = $state<"idle" | "copying" | "copied" | "failed">("idle");

  // Redacted like the log: the panel ends up in screenshots and bug reports.
  function messageOf(error: unknown) {
    return redactSecrets(describeError(error).split("\n")[0] ?? "");
  }

  function handleError(error: unknown) {
    reportJsError("render", error, page.url?.pathname);
    console.error("[render-error-boundary]", error);
  }

  async function copyDetailsForSupport(error: unknown) {
    copyState = "copying";
    const logTail = await readRecentLogTail();
    const report = buildSupportReport({
      message: messageOf(error),
      route: page.url?.pathname,
      appVersion,
      logTail,
    });
    copyState = (await copyToClipboard(report)) ? "copied" : "failed";
    setTimeout(() => (copyState = "idle"), 2500);
  }
</script>

<svelte:boundary onerror={handleError}>
  {@render children()}

  {#snippet failed(error, reset)}
    <div
      role="alert"
      data-testid="render-error-boundary"
      class="m-auto max-w-md px-6 py-10 text-center text-foreground"
    >
      <h2 class="mb-2 text-xl font-semibold">Something went wrong</h2>
      <p class="mb-1 text-sm text-muted-foreground">This page stopped rendering.</p>
      <p class="mb-6 break-words font-mono text-xs text-muted-foreground">{messageOf(error)}</p>
      <div class="flex flex-wrap items-center justify-center gap-3">
        <button
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
          onclick={reset}
        >
          Try again
        </button>
        <button
          class="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted"
          onclick={() => window.location.reload()}
        >
          Reload page
        </button>
        <button
          class="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:opacity-60"
          disabled={copyState === "copying"}
          onclick={() => copyDetailsForSupport(error)}
        >
          {#if copyState === "copied"}
            Copied
          {:else if copyState === "failed"}
            Copy failed
          {:else}
            Copy details for support
          {/if}
        </button>
      </div>
      <p class="mt-3 text-[11px] text-muted-foreground/70">
        The error is saved in the app log. Copy details for support adds the recent log lines with
        secrets removed.
      </p>
    </div>
  {/snippet}
</svelte:boundary>
