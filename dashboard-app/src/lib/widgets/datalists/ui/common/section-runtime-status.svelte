<script lang="ts">
  import { Badge } from "$shared/ui/badge";
  import { Button } from "$shared/ui/button";

  type SectionRuntimeSourceState = "live" | "cached" | "stale" | "paused" | "error" | "idle";
  type SectionRuntimeMode = "stream" | "poll" | "manual" | "on-demand";

  type Props = {
    sectionLabel: string;
    profileLabel: string;
    sourceState: SectionRuntimeSourceState;
    mode?: SectionRuntimeMode | null;
    budgetSummary?: string | null;
    lastUpdatedLabel?: string | null;
    detail?: string | null;
    secondaryActionLabel?: string | null;
    secondaryActionAriaLabel?: string | null;
    secondaryActionLoading?: boolean;
    onSecondaryAction?: (() => void) | null;
    reason?: string | null;
    actionLabel?: string | null;
    actionAriaLabel?: string | null;
    onAction?: (() => void) | null;
  };

  let {
    sectionLabel,
    profileLabel,
    sourceState,
    mode = null,
    budgetSummary = null,
    lastUpdatedLabel = null,
    detail = null,
    secondaryActionLabel = null,
    secondaryActionAriaLabel = null,
    secondaryActionLoading = false,
    onSecondaryAction = null,
    reason = null,
    actionLabel = null,
    actionAriaLabel = null,
    onAction = null,
  }: Props = $props();

  function sourceTone(state: SectionRuntimeSourceState) {
    if (state === "live") return "bg-emerald-600 text-white";
    if (state === "cached") return "bg-sky-600 text-white";
    if (state === "stale") return "bg-amber-600 text-white";
    if (state === "paused") return "bg-slate-500 text-white";
    if (state === "error") return "bg-rose-600 text-white";
    return "bg-muted text-foreground";
  }

  function sourceLabel(state: SectionRuntimeSourceState) {
    if (state === "live") return "Live";
    if (state === "cached") return "Cached";
    if (state === "stale") return "Stale";
    if (state === "paused") return "Paused";
    if (state === "error") return "Error";
    return "Idle";
  }

</script>

<div class="rounded-lg border border-border/70 bg-background/80 px-4 py-3 shadow-sm">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0 space-y-1">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium">{sectionLabel}</span>
        <Badge class={sourceTone(sourceState)}>{sourceLabel(sourceState)}</Badge>
        {#if mode}
          <span class="rounded border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
            {mode}
          </span>
        {/if}
      </div>
      <div class="text-xs text-muted-foreground">
        {profileLabel}
        {#if budgetSummary}
          · {budgetSummary}
        {/if}
      </div>
    </div>
    <div class="flex items-start gap-2">
      {#if lastUpdatedLabel}
        <span class="text-[10px] tabular-nums text-muted-foreground">{lastUpdatedLabel}</span>
      {/if}
      {#if detail}
        <div class="max-w-[32rem] text-xs text-muted-foreground text-right">{detail}</div>
      {/if}
      {#if onSecondaryAction && secondaryActionLabel && sourceState !== "live" && sourceState !== "idle"}
        <Button
          variant="outline"
          size="sm"
          aria-label={secondaryActionAriaLabel ?? secondaryActionLabel}
          disabled={secondaryActionLoading}
          onclick={() => onSecondaryAction?.()}
        >
          {secondaryActionLoading ? "Refreshing" : secondaryActionLabel}
        </Button>
      {/if}
      {#if onAction && actionLabel}
        <Button
          variant="outline"
          size="sm"
          aria-label={actionAriaLabel ?? actionLabel}
          onclick={() => onAction?.()}
        >
          {actionLabel}
        </Button>
      {/if}
    </div>
  </div>
  {#if reason}
    <div class="mt-2 text-xs text-muted-foreground">{reason}</div>
  {/if}
</div>
