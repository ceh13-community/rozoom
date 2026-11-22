<script lang="ts">
  import type { ClusterHealthChecks, ClusterRuleStatus } from "$features/check-health";
  import { buildClusterScore } from "$features/check-health";
  import { STATUS_CLASSES } from "$entities/cluster";
  import { Badge } from "$shared/ui/badge";
  import { Gauge } from "$shared/ui/icons";

  interface Props {
    checks: ClusterHealthChecks | null;
  }

  const { checks }: Props = $props();

  const scoreSummary = $derived.by(() => buildClusterScore(checks));

  const statusClass = $derived.by(() => {
    if (scoreSummary.status === "healthy") return STATUS_CLASSES.ok;
    if (scoreSummary.status === "at-risk") return STATUS_CLASSES.warning;
    if (scoreSummary.status === "unsafe") return STATUS_CLASSES.error;
    return STATUS_CLASSES.unknown;
  });

  const statusEmoji = $derived.by(() => {
    if (scoreSummary.status === "healthy") return "🟢";
    if (scoreSummary.status === "at-risk") return "🟠";
    if (scoreSummary.status === "unsafe") return "🔴";
    return "⚪";
  });

  const scoreText = $derived.by(() => {
    if (scoreSummary.score === null) return "-";
    return `${Math.round(scoreSummary.score)}`;
  });
  let detailsOpen = $state(false);

  // Top risks show three rules; the full list shows every rule with its verdict and the
  // objects it flagged, so a passed rule is told apart from one that never ran.
  const RULE_STATUS_LABEL: Record<ClusterRuleStatus, string> = {
    fail: "Fail",
    pass: "Pass",
    "not-checked": "Not checked",
  };
  const RULE_STATUS_CLASS: Record<ClusterRuleStatus, string> = {
    fail: "text-rose-700 dark:text-rose-300",
    pass: "text-emerald-700 dark:text-emerald-300",
    "not-checked": "text-muted-foreground",
  };
  const REFERENCE_LIMIT = 20;

  const ruleCounts = $derived.by(() => {
    const counts = { fail: 0, pass: 0, "not-checked": 0 };
    for (const rule of scoreSummary.rules) counts[rule.status] += 1;
    return counts;
  });

  const indicatorNotes = [
    {
      title: "Resources hygiene",
      description: "Requests/limits coverage for predictable scheduling and autoscaling.",
    },
    {
      title: "HPA/VPA",
      description: "Valid autoscaling targets and no HPA/VPA Auto conflicts.",
    },
    {
      title: "QoS class",
      description: "BestEffort pods are at highest eviction risk under pressure.",
    },
    {
      title: "Probes",
      description: "Readiness/liveness/startup probes to detect and recover from failures.",
    },
    {
      title: "Topology & PDB",
      description: "Replica spread and disruption budgets for safe drains and HA.",
    },
    {
      title: "PSA & SecurityContext",
      description: "Pod security standards and hardened runtime defaults.",
    },
    {
      title: "NetworkPolicy",
      description: "Default-deny and allowed flows to limit lateral movement.",
    },
    {
      title: "Secrets hygiene",
      description: "Detects secret-like values stored in ConfigMaps.",
    },
    {
      title: "PriorityClass",
      description: "Critical workloads keep priority during eviction pressure.",
    },
  ];

  const platformNotes = [
    {
      title: "Bare metal / on-prem",
      description:
        "Ensure metrics-server, CNI, and storage add-ons are present; API latency impacts health checks.",
    },
    {
      title: "RKE",
      description:
        "RBAC for kube-system resources is often restricted; avoid broad list calls for secrets.",
    },
    {
      title: "K3s",
      description:
        "Single-node clusters need careful PDB/replica expectations and lightweight metrics.",
    },
    {
      title: "EKS",
      description: "IRSA/RBAC may block node or secrets visibility; prefer namespace-scoped reads.",
    },
    {
      title: "GKE",
      description:
        "Pod Security Admission and GKE policy may block privileged workloads by default.",
    },
    {
      title: "AKS",
      description:
        "NetworkPolicy enforcement varies by CNI; baseline policies should match CNI support.",
    },
    {
      title: "DigitalOcean",
      description: "Managed control planes can throttle large list requests; keep checks scoped.",
    },
    {
      title: "OpenShift",
      description:
        "SCC/PSA interactions require elevated permissions; secure defaults are stricter.",
    },
    {
      title: "OKE",
      description:
        "OCI API throttling may require smaller queries; ensure metrics endpoints are installed.",
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
          Reliability and security
        </div>
        <div class="mt-1 text-2xl font-semibold">
          {#if scoreSummary.score === null}
            {scoreText}
          {:else}
            {scoreText} / 100
          {/if}
        </div>
        <div class="text-xs text-muted-foreground">
          {statusEmoji} {scoreSummary.statusLabel}
        </div>
      </div>
      <div class="flex flex-col items-end gap-2">
        <Badge class={`text-white ${statusClass}`}>{scoreSummary.statusLabel}</Badge>
        <div class="text-xs text-muted-foreground">
          {detailsOpen ? "Collapse details" : "Expand for details"}
        </div>
      </div>
    </div>
  </summary>

  <div class="mt-3 border-t border-border/60 pt-3">
    <div class="text-xs text-muted-foreground">
      Reliability {scoreSummary.reliabilityScore ?? "-"}/50 · Security {scoreSummary.securityScore ?? "-"}/50
    </div>

    {#if scoreSummary.topRisks.length}
      <div class="mt-3">
        <div class="flex items-center justify-between text-xs font-semibold">
          <span>Top risks</span>
          <span class="text-muted-foreground">Fixing these gives +{scoreSummary.scoreDelta}</span>
        </div>
        <ul class="mt-2 space-y-1 text-xs text-foreground">
          {#each scoreSummary.topRisks as risk (risk.id)}
            <li class="flex items-start justify-between gap-2">
              <span class="mt-0.5">{risk.severity === "critical" ? "❌" : "⚠️"}</span>
              <div class="flex-1">
                <div class="font-medium">{risk.title}</div>
                <div class="text-xs text-muted-foreground">{risk.reason}</div>
              </div>
              <span class="text-xs text-muted-foreground">+{risk.penalty}</span>
            </li>
          {/each}
        </ul>
      </div>
    {:else}
      <div class="mt-3 text-xs text-muted-foreground">
        No major risks detected yet. Run health checks to populate the score.
      </div>
    {/if}

    <details
      class="mt-3 rounded border border-border/80 bg-muted/20 px-2 py-2"
      data-testid="cluster-score-rules"
    >
      <summary class="cursor-pointer text-xs font-semibold text-muted-foreground">
        All rules: {ruleCounts.fail} failing, {ruleCounts.pass} passing, {ruleCounts["not-checked"]}
        not checked
      </summary>
      <ul class="mt-2 space-y-2 text-xs">
        {#each scoreSummary.rules as rule (rule.id)}
          <li
            class="flex items-start gap-2"
            data-testid="cluster-score-rule"
            data-rule-id={rule.id}
            data-rule-status={rule.status}
          >
            <span class={`w-20 shrink-0 font-semibold ${RULE_STATUS_CLASS[rule.status]}`}>
              {RULE_STATUS_LABEL[rule.status]}
            </span>
            <div class="min-w-0 flex-1">
              <div class="font-medium text-foreground">
                {rule.title}
                <span class="font-normal text-muted-foreground">
                  ({rule.category === "security" ? "Security" : "Reliability"})
                </span>
              </div>
              {#if rule.risk}
                <div class="text-muted-foreground">{rule.risk.title}. {rule.risk.fix}</div>
                {#if rule.risk.references.length}
                  <ul class="mt-1 space-y-0.5 font-mono text-foreground">
                    {#each rule.risk.references.slice(0, REFERENCE_LIMIT) as reference (reference)}
                      <li class="break-all">{reference}</li>
                    {/each}
                  </ul>
                  {#if rule.risk.references.length > REFERENCE_LIMIT}
                    <div class="text-muted-foreground">
                      +{rule.risk.references.length - REFERENCE_LIMIT} more
                    </div>
                  {/if}
                {:else}
                  <div class="text-muted-foreground">This check reports a count, not names.</div>
                {/if}
              {:else if rule.status === "not-checked"}
                <div class="text-muted-foreground">
                  The check behind this rule has not run or could not read the cluster.
                </div>
              {/if}
            </div>
            {#if rule.risk}
              <span class="shrink-0 text-muted-foreground">+{rule.risk.penalty}</span>
            {/if}
          </li>
        {/each}
      </ul>
    </details>

    <details class="mt-3 rounded border border-border/80 bg-muted/20 px-2 py-2">
      <summary class="cursor-pointer text-xs font-semibold text-muted-foreground">
        Indicator explanations
      </summary>
      <ul class="mt-2 space-y-2 text-xs text-muted-foreground">
        {#each indicatorNotes as note (note.title)}
          <li>
            <span class="font-medium text-foreground">{note.title}:</span>
            {note.description}
          </li>
        {/each}
      </ul>
    </details>

    <details class="mt-2 rounded border border-border/80 bg-muted/20 px-2 py-2">
      <summary class="cursor-pointer text-xs font-semibold text-muted-foreground">
        Platform fit review
      </summary>
      <ul class="mt-2 space-y-2 text-xs text-muted-foreground">
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
