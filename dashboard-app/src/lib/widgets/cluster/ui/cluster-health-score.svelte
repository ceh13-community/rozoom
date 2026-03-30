<script lang="ts">
  import type { ClusterHealthChecks } from "$features/check-health";
  import { buildClusterHealthScore } from "$features/check-health";
  import { STATUS_CLASSES } from "$entities/cluster";
  import { Badge } from "$shared/ui/badge";
  import { Gauge } from "$shared/ui/icons";

  interface Props {
    checks: ClusterHealthChecks | null;
  }

  const { checks }: Props = $props();

  const scoreSummary = $derived.by(() => buildClusterHealthScore(checks));

  const statusClass = $derived.by(() => {
    if (scoreSummary.status === "healthy") return STATUS_CLASSES.ok;
    if (scoreSummary.status === "degraded") return STATUS_CLASSES.warning;
    if (scoreSummary.status === "unhealthy") return STATUS_CLASSES.error;
    return STATUS_CLASSES.unknown;
  });

  const statusEmoji = $derived.by(() => {
    if (scoreSummary.status === "healthy") return "🟢";
    if (scoreSummary.status === "degraded") return "🟠";
    if (scoreSummary.status === "unhealthy") return "🔴";
    return "⚪";
  });

  const scoreText = $derived.by(() => {
    if (scoreSummary.score === null) return "-";
    return `${Math.round(scoreSummary.score)}`;
  });
  let detailsOpen = $state(false);

  const indicatorNotes = [
    {
      title: "API stability",
      description: "Tracks deprecations and removed APIs that can break upgrades.",
    },
    {
      title: "Backup freshness",
      description: "Evaluates backup recency and ability to recover cluster state.",
    },
    {
      title: "Alert signal quality",
      description: "Checks if alerts are actionable and not dominated by noise.",
    },
    {
      title: "Metrics pipeline",
      description: "Verifies kubelet/metrics-server/exporters for reliable observability.",
    },
  ];

  const platformNotes = [
    {
      title: "Minikube / local",
      description: "Single-node labs have lower HA expectations; backup/alerts can be partial.",
    },
    {
      title: "Managed Kubernetes",
      description: "RBAC and provider defaults may hide control-plane level findings.",
    },
    {
      title: "Air-gapped / restricted",
      description: "External feeds and chart metadata may be unreachable; status may be unknown.",
    },
  ];
</script>

<details
  bind:open={detailsOpen}
  class="rounded-lg border border-border bg-card px-3 py-3 text-xs text-card-foreground"
>
  <summary class="list-none cursor-pointer">
    <div class="flex items-center justify-between gap-3">
      <div>
        <div class="flex items-center gap-2 text-xs font-semibold text-foreground">
          <Gauge class="h-4 w-4 text-muted-foreground" />
          Health score
        </div>
        <div class="mt-1 text-2xl font-semibold">
          {#if scoreSummary.score === null}
            {scoreText}
          {:else}
            {scoreText} / 100
          {/if}
        </div>
        <div class="text-xs text-muted-foreground">{statusEmoji} {scoreSummary.statusLabel}</div>
      </div>
      <div class="flex flex-col items-end gap-2">
        <Badge class={`text-white ${statusClass}`}>{scoreSummary.statusLabel}</Badge>
        <div class="text-[11px] text-muted-foreground">
          {detailsOpen ? "Collapse details" : "Expand for details"}
        </div>
      </div>
    </div>
  </summary>

  <div class="mt-3 border-t border-border/60 pt-3">
    <div class="text-[11px] text-muted-foreground">
      {#if scoreSummary.domains.length}
        {#each scoreSummary.domains as domain, index (domain.domain)}
          {domain.label} {domain.score ?? "-"}/{domain.weight}{index <
          scoreSummary.domains.length - 1
            ? " · "
            : ""}
        {/each}
      {:else}
        No health data yet
      {/if}
    </div>

    {#if scoreSummary.topRisks.length}
      <div class="mt-3">
        <div class="flex items-center justify-between text-xs font-semibold">
          <span>Top degradations</span>
          <span class="text-muted-foreground">Fixing these gives +{scoreSummary.scoreDelta}</span>
        </div>
        <ul class="mt-2 space-y-1 text-xs text-foreground">
          {#each scoreSummary.topRisks as risk (risk.id)}
            <li class="flex items-start justify-between gap-2">
              <span class="mt-0.5">{risk.severity === "critical" ? "❌" : "⚠️"}</span>
              <div class="flex-1">
                <div class="font-medium">{risk.title}</div>
                <div class="text-[11px] text-muted-foreground">{risk.reason}</div>
              </div>
              <span class="text-[11px] text-muted-foreground">+{risk.penalty}</span>
            </li>
          {/each}
        </ul>
      </div>
    {:else}
      <div class="mt-3 text-[11px] text-muted-foreground">
        No active degradations detected yet. Run health checks to populate the score.
      </div>
    {/if}

    <details class="mt-3 rounded border border-border/80 bg-muted/20 px-2 py-2">
      <summary class="cursor-pointer text-[11px] font-semibold text-muted-foreground">
        Indicator explanations
      </summary>
      <ul class="mt-2 space-y-2 text-[11px] text-muted-foreground">
        {#each indicatorNotes as note (note.title)}
          <li>
            <span class="font-medium text-foreground">{note.title}:</span>
            {note.description}
          </li>
        {/each}
      </ul>
    </details>

    <details class="mt-2 rounded border border-border/80 bg-muted/20 px-2 py-2">
      <summary class="cursor-pointer text-[11px] font-semibold text-muted-foreground">
        Platform fit review
      </summary>
      <ul class="mt-2 space-y-2 text-[11px] text-muted-foreground">
        {#each platformNotes as note (note.title)}
          <li>
            <span class="font-medium text-foreground">{note.title}:</span>
            {note.description}
          </li>
        {/each}
      </ul>
    </details>
  </div>
</details>
