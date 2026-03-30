<script lang="ts">
  import { Badge } from "$shared/ui/badge";
  import type {
    ClusterRequestInspectorRow,
    ClusterRequestInspectorSummary,
  } from "$pages/cluster/model/cluster-page-runtime";

  type Props = {
    summary: ClusterRequestInspectorSummary;
    rows: ClusterRequestInspectorRow[];
    formatAt: (value: number | null) => string;
  };

  let { summary, rows, formatAt }: Props = $props();

  function toneClass(tone: ClusterRequestInspectorRow["tone"]) {
    if (tone === "error") return "bg-rose-600 text-white";
    if (tone === "warn") return "bg-amber-600 text-white";
    if (tone === "muted") return "bg-slate-500 text-white";
    return "bg-emerald-600 text-white";
  }
</script>

<div class="w-[440px] space-y-4">
  <div class="space-y-1">
    <div class="text-sm font-medium">Request / Debug Inspector</div>
    <div class="text-xs text-muted-foreground">
      Recent cache decisions, watcher fallback reasons, and debug actions for this cluster.
    </div>
  </div>

  <div class="grid gap-3 sm:grid-cols-3">
    <div class="rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
      <div class="text-xs text-muted-foreground">Recent events</div>
      <div class="mt-1 font-semibold">{summary.sampleSize}</div>
      <div class="text-xs text-muted-foreground">last: {formatAt(summary.lastEventAt)}</div>
    </div>
    <div class="rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
      <div class="text-xs text-muted-foreground">Cache path</div>
      <div class="mt-1 font-semibold">{summary.cacheEvents}</div>
      <div class="text-xs text-muted-foreground">cache or stale-cache decisions</div>
    </div>
    <div class="rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
      <div class="text-xs text-muted-foreground">Degraded signals</div>
      <div class="mt-1 font-semibold">{summary.degradedEvents}</div>
      <div class="text-xs text-muted-foreground">fallback, retry, or error conditions</div>
    </div>
  </div>

  <div class="max-h-[420px] overflow-auto rounded-md border border-border/60 bg-muted/20 p-3">
    <div class="mb-2 text-xs font-semibold text-muted-foreground">Recent operator trace</div>
    {#if rows.length === 0}
      <div class="text-sm text-muted-foreground">No runtime events recorded for this cluster yet.</div>
    {:else}
      <div class="space-y-2">
        {#each rows as row (row.id)}
          <div class="rounded-md border border-border/50 bg-background/80 p-3">
            <div class="mb-1 flex items-start justify-between gap-3">
              <div class="min-w-0 space-y-1">
                <div class="flex flex-wrap items-center gap-2">
                  <Badge class={toneClass(row.tone)}>{row.source}</Badge>
                  <span class="text-sm font-medium">{row.title}</span>
                </div>
                <div class="text-xs text-muted-foreground">{row.detail}</div>
              </div>
              <div class="shrink-0 text-[11px] text-muted-foreground">{formatAt(row.at)}</div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
