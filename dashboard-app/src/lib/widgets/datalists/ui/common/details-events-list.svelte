<script lang="ts">
  import LoadingDots from "$shared/ui/loading-dots.svelte";

  type DetailsEvent = {
    type?: string;
    reason?: string;
    message?: string;
    lastTimestamp?: string;
    source?: string;
    count?: string | number;
  };

  interface DetailsEventsListProps {
    events?: DetailsEvent[];
    loading?: boolean;
    error?: string | null;
    loadingText?: string;
    emptyText?: string;
  }

  const {
    events = [],
    loading = false,
    error = null,
    loadingText = "Loading events",
    emptyText = "No events found.",
  }: DetailsEventsListProps = $props();

  function getEventTypeClass(type: string) {
    return type.toLowerCase() === "warning"
      ? "text-amber-700 dark:text-amber-400"
      : "text-emerald-700 dark:text-emerald-400";
  }

  function getEventSeverityClass(type: string) {
    return type.toLowerCase() === "warning"
      ? "border-amber-300/60 bg-amber-50/40 dark:border-amber-500/40 dark:bg-amber-500/10"
      : "border-emerald-300/60 bg-emerald-50/40 dark:border-emerald-500/40 dark:bg-emerald-500/10";
  }

  function toTimestampValue(value?: string) {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const sortedEvents = $derived.by(() =>
    [...events].sort((a, b) => toTimestampValue(b.lastTimestamp) - toTimestampValue(a.lastTimestamp)),
  );
</script>

{#if error}
  <div class="mb-2 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
    {error}
  </div>
{/if}

{#if loading}
  <div class="text-sm text-muted-foreground">{loadingText}<LoadingDots /></div>
{:else if sortedEvents.length === 0}
  <div class="rounded border p-3 text-sm text-muted-foreground">{emptyText}</div>
{:else}
  <div class="space-y-2 text-sm">
    {#each sortedEvents as event}
      {@const eventType = event.type?.trim() || "Normal"}
      <div class={`rounded border p-2 ${getEventSeverityClass(eventType)}`}>
        <div class="font-medium">
          <span class={getEventTypeClass(eventType)}>{eventType}</span>
          {" / "}
          {event.reason?.trim() || "-"}
        </div>
        <div class="break-words text-muted-foreground">{event.message?.trim() || "-"}</div>
        <div class="text-xs text-muted-foreground">
          {event.lastTimestamp?.trim() || "-"}
          {#if event.source}
            {" · "}
            {event.source}
          {/if}
          {#if event.count !== undefined}
            {" · count: "}
            {event.count}
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
