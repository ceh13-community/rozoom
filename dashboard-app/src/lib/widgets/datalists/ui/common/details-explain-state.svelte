<script lang="ts">
  interface DetailsExplainStateProps {
    sourceState?: "live" | "cached" | "stale" | "paused" | "error" | "idle";
    profileLabel?: string | null;
    lastUpdatedLabel?: string | null;
    detail?: string | null;
    reason?: string | null;
    requestPath?: string | null;
    describeCommand?: string | null;
    syncError?: string | null;
  }

  const {
    sourceState = "idle",
    profileLabel = null,
    lastUpdatedLabel = null,
    detail = null,
    reason = null,
    requestPath = null,
    describeCommand = null,
    syncError = null,
  }: DetailsExplainStateProps = $props();

  function getSourceStateLabel(state: DetailsExplainStateProps["sourceState"]) {
    switch (state) {
      case "live":
        return "Live watcher";
      case "cached":
        return "Cached snapshot";
      case "stale":
        return "Stale cache";
      case "paused":
        return "Paused";
      case "error":
        return "Degraded";
      default:
        return "Idle";
    }
  }

  function getSourceTone(state: DetailsExplainStateProps["sourceState"]) {
    switch (state) {
      case "live":
        return "border-emerald-300/60 bg-emerald-50/40 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200";
      case "cached":
        return "border-sky-300/60 bg-sky-50/40 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200";
      case "stale":
        return "border-amber-300/60 bg-amber-50/40 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200";
      case "paused":
        return "border-slate-300/60 bg-slate-50/60 text-slate-700 dark:border-slate-500/40 dark:bg-slate-500/10 dark:text-slate-200";
      case "error":
        return "border-rose-300/60 bg-rose-50/40 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200";
      default:
        return "border-border bg-muted/30 text-muted-foreground";
    }
  }
</script>

<details class="mt-4 rounded border border-border bg-card" data-testid="details-explain-state" open={!!syncError}>
  <summary class="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-sm font-semibold select-none">
    Explain this state
    <span class={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${getSourceTone(sourceState)}`}>
      {getSourceStateLabel(sourceState)}
    </span>
    {#if profileLabel}
      <span class="text-xs font-normal text-muted-foreground">{profileLabel}</span>
    {/if}
    {#if lastUpdatedLabel}
      <span class="text-xs font-normal text-muted-foreground">{lastUpdatedLabel}</span>
    {/if}
  </summary>

  <div class="grid grid-cols-1 gap-3 px-4 pb-4 text-sm sm:grid-cols-2">
    <div class="rounded border p-3">
      <div class="text-xs text-muted-foreground">Source of truth</div>
      <div class="mt-1">{getSourceStateLabel(sourceState)}</div>
    </div>
    <div class="rounded border p-3">
      <div class="text-xs text-muted-foreground">Request path</div>
      <div class="mt-1">{requestPath ?? "-"}</div>
    </div>
    <div class="rounded border p-3 sm:col-span-2">
      <div class="text-xs text-muted-foreground">Runtime summary</div>
      <div class="mt-1">{detail ?? "-"}</div>
    </div>
    <div class="rounded border p-3 sm:col-span-2">
      <div class="text-xs text-muted-foreground">Current reason</div>
      <div class="mt-1 break-words">{reason ?? "-"}</div>
    </div>
    <div class="rounded border p-3 sm:col-span-2">
      <div class="text-xs text-muted-foreground">Describe command path</div>
      <code class="mt-1 block break-all rounded bg-muted px-2 py-1 text-xs text-foreground">
        {describeCommand ?? "-"}
      </code>
    </div>
    {#if syncError}
      <div class="rounded border border-rose-300/70 bg-rose-50/60 p-3 text-rose-900 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-100 sm:col-span-2">
        <div class="text-xs uppercase tracking-wide opacity-80">Last sync error</div>
        <div class="mt-1 break-words text-sm">{syncError}</div>
      </div>
    {/if}
  </div>
</details>
