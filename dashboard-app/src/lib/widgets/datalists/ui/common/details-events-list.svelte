<script lang="ts">
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import { groupDetailsEvents, type DetailsEvent } from "./details-events-model";

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

  // One row per distinct event, repeats folded into it (xN), Warning first, newest first.
  const rows = $derived(groupDetailsEvents(events));
</script>

{#if error}
  <div
    class="mb-2 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
  >
    {error}
  </div>
{/if}

{#if loading}
  <div class="text-sm text-muted-foreground">{loadingText}<LoadingDots /></div>
{:else if rows.length === 0}
  <div class="rounded border p-3 text-sm text-muted-foreground">{emptyText}</div>
{:else}
  <div class="space-y-2 text-sm">
    {#each rows as event, index (index)}
      <div
        class={`rounded border p-2 ${getEventSeverityClass(event.type)}`}
        data-testid="details-event"
      >
        <div class="flex items-start justify-between gap-2 font-medium">
          <span>
            <span class={getEventTypeClass(event.type)}>{event.type}</span>
            {" / "}
            {event.reason}
          </span>
          {#if event.count > 1}
            <span
              class="shrink-0 rounded bg-muted px-1.5 text-xs tabular-nums text-muted-foreground"
              title={`Happened ${event.count} times`}>x{event.count}</span
            >
          {/if}
        </div>
        <div class="break-words text-muted-foreground">{event.message}</div>
        <div class="text-xs text-muted-foreground">
          {event.lastTimestamp}
          {#if event.object}
            {" · "}
            {event.object}
          {/if}
          {#if event.source}
            {" · "}
            {event.source}
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
