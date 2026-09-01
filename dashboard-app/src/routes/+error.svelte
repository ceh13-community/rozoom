<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import {
    buildSupportReport,
    copyToClipboard,
    readRecentLogTail,
  } from "$shared/lib/support-diagnostics";

  const appVersion: string = __APP_VERSION__;
  let copyState = $state<"idle" | "copying" | "copied" | "failed">("idle");

  async function copyDetailsForSupport() {
    copyState = "copying";
    const logTail = await readRecentLogTail();
    const report = buildSupportReport({
      message: page.error?.message ?? "",
      status: page.status,
      route: page.url?.pathname,
      appVersion,
      logTail,
    });
    copyState = (await copyToClipboard(report)) ? "copied" : "failed";
    setTimeout(() => (copyState = "idle"), 2500);
  }
</script>

<main class="flex flex-col h-screen bg-background text-foreground">
  <div class="m-auto max-w-md text-center px-6">
    <div class="text-6xl font-bold text-muted-foreground/30 mb-4">{page.status}</div>
    <h1 class="text-xl font-semibold mb-2">Something went wrong</h1>
    <p class="text-sm text-muted-foreground mb-6">
      {page.error?.message || "An unexpected error occurred."}
    </p>
    <div class="flex items-center justify-center gap-3">
      <button
        class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition"
        onclick={() => goto("/dashboard")}
      >
        Go to Dashboard
      </button>
      <button
        class="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition"
        onclick={() => window.location.reload()}
      >
        Reload page
      </button>
      <button
        class="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition disabled:opacity-60"
        disabled={copyState === "copying"}
        onclick={copyDetailsForSupport}
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
      Copies the error, app version and recent log lines with secrets removed - paste it into a
      Telegram message or GitHub issue.
    </p>
  </div>
</main>
