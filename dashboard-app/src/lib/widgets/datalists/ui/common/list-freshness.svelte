<script lang="ts">
  import { liveNowMs } from "$shared/lib/live-age.svelte";
  import { formatAgeMs } from "$shared/lib/timeFormatters";
  import { describeListFreshness, type ListFreshnessTone } from "./list-freshness";
  import { readListFreshness } from "./list-freshness-context.svelte";

  const source = readListFreshness();

  const view = $derived(
    source
      ? describeListFreshness(
          {
            state: source.state,
            mode: source.mode,
            updatedAt: source.updatedAt,
            streamLive: source.streamLive,
          },
          // Ticks only while the label shows a time.
          source.updatedAt ? liveNowMs() : Date.now(),
          formatAgeMs,
        )
      : null,
  );

  const TONES: Record<ListFreshnessTone, string> = {
    live: "text-emerald-600 dark:text-emerald-400",
    ok: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    error: "text-rose-600 dark:text-rose-400",
    muted: "text-muted-foreground",
  };
</script>

{#if view}
  <span
    class={`whitespace-nowrap text-sm tabular-nums ${TONES[view.tone]}`}
    title={view.title}
    data-testid="list-freshness"
  >
    <span aria-hidden="true">●</span>
    {view.label}
  </span>
{/if}
