<script lang="ts">
  import { onMount } from "svelte";
  import {
    buildRbacRiskReport,
    type RbacRiskReport,
    type RbacRoleRisk,
    type RbacRiskFinding,
    type RbacRiskLevel,
  } from "$features/workloads-management/model/rbac-risk-scanner";
  import {
    buildPssReport,
    type PssReport,
    type PssPodResult,
    type PssLevel,
  } from "$features/workloads-management/model/pss-compliance";
  import {
    normalizeRbacRoles,
    normalizePodsForPss,
    PSS_CHECK_CATALOG,
    PSS_SCAN_OVERVIEW,
    RBAC_RULE_CATALOG,
    RBAC_SCAN_OVERVIEW,
  } from "$features/security-audit";
  import { kubectlJson } from "$shared/api/kubectl-proxy";
  import * as Card from "$shared/ui/card";
  import * as Alert from "$shared/ui/alert";
  import { Badge } from "$shared/ui/badge";
  import { Button } from "$shared/ui/button";
  import LoadingDots from "$shared/ui/loading-dots.svelte";

  interface Props {
    clusterId: string;
    offline?: boolean;
  }

  const { clusterId, offline = false }: Props = $props();

  type Phase = "idle" | "running" | "done" | "error";

  let phase = $state<Phase>("idle");
  let errorMessage = $state<string | null>(null);
  let lastScanAt = $state<number | null>(null);
  let rbacReport = $state<RbacRiskReport | null>(null);
  let pssReport = $state<PssReport | null>(null);
  let aboutOpen = $state(false);
  let expandedRole = $state<string | null>(null);
  let expandedPod = $state<string | null>(null);
  let pssLevelFilter = $state<"all" | "baseline" | "restricted">("all");

  const criticalRoles = $derived<RbacRoleRisk[]>(
    rbacReport?.roles.filter((r) => r.highestRisk === "critical") ?? [],
  );
  const highRoles = $derived<RbacRoleRisk[]>(
    rbacReport?.roles.filter((r) => r.highestRisk === "high") ?? [],
  );
  const mediumRoles = $derived<RbacRoleRisk[]>(
    rbacReport?.roles.filter((r) => r.highestRisk === "medium") ?? [],
  );

  const failingPods = $derived<PssPodResult[]>(
    pssReport?.pods.filter((p) => p.violations.length > 0) ?? [],
  );
  const filteredFailingPods = $derived<PssPodResult[]>(
    pssLevelFilter === "all"
      ? failingPods
      : failingPods.filter((p) => p.violations.some((v) => v.level === pssLevelFilter)),
  );

  function rbacBadgeClass(level: RbacRiskLevel): string {
    switch (level) {
      case "critical":
        return "bg-rose-500/15 text-rose-300 border-rose-500/40";
      case "high":
        return "bg-amber-500/15 text-amber-300 border-amber-500/40";
      case "medium":
        return "bg-yellow-500/15 text-yellow-300 border-yellow-500/40";
      default:
        return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
    }
  }

  function pssBadgeClass(level: PssLevel): string {
    switch (level) {
      case "baseline":
        return "bg-amber-500/15 text-amber-300 border-amber-500/40";
      case "restricted":
        return "bg-sky-500/15 text-sky-300 border-sky-500/40";
      default:
        return "bg-rose-500/15 text-rose-300 border-rose-500/40";
    }
  }

  function pssLevelBadge(level: PssLevel): string {
    switch (level) {
      case "restricted":
        return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
      case "baseline":
        return "bg-amber-500/15 text-amber-300 border-amber-500/40";
      default:
        return "bg-rose-500/15 text-rose-300 border-rose-500/40";
    }
  }

  function roleKey(role: RbacRoleRisk): string {
    return `${role.kind}/${role.namespace ?? "cluster"}/${role.name}`;
  }

  function podKey(pod: PssPodResult): string {
    return `${pod.namespace}/${pod.pod}`;
  }

  function relativeTime(ts: number | null): string {
    if (!ts) return "never";
    const diffMs = Date.now() - ts;
    if (diffMs < 60_000) return "just now";
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  }

  async function runScan() {
    if (phase === "running" || offline) return;
    phase = "running";
    errorMessage = null;
    try {
      const [clusterRolesResp, rolesResp, podsResp] = await Promise.all([
        kubectlJson<{ items?: unknown[] }>("get clusterroles --request-timeout=15s", {
          clusterId,
        }),
        kubectlJson<{ items?: unknown[] }>("get roles --all-namespaces --request-timeout=15s", {
          clusterId,
        }),
        kubectlJson<{ items?: unknown[] }>("get pods --all-namespaces --request-timeout=30s", {
          clusterId,
        }),
      ]);
      const errs: string[] = [];
      if (typeof clusterRolesResp === "string") errs.push(`ClusterRoles: ${clusterRolesResp}`);
      if (typeof rolesResp === "string") errs.push(`Roles: ${rolesResp}`);
      if (typeof podsResp === "string") errs.push(`Pods: ${podsResp}`);
      if (errs.length > 0) {
        throw new Error(errs.join("\n"));
      }

      const rbacInputs = normalizeRbacRoles(
        clusterRolesResp as Parameters<typeof normalizeRbacRoles>[0],
        rolesResp as Parameters<typeof normalizeRbacRoles>[1],
      );
      const pssInputs = normalizePodsForPss(podsResp as Parameters<typeof normalizePodsForPss>[0]);

      rbacReport = buildRbacRiskReport(rbacInputs);
      pssReport = buildPssReport(pssInputs);
      lastScanAt = Date.now();
      phase = "done";
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      phase = "error";
    }
  }

  function toggleRole(role: RbacRoleRisk) {
    const k = roleKey(role);
    expandedRole = expandedRole === k ? null : k;
  }

  function togglePod(pod: PssPodResult) {
    const k = podKey(pod);
    expandedPod = expandedPod === k ? null : k;
  }

  function dedupeFindings(findings: RbacRiskFinding[]): RbacRiskFinding[] {
    const seen = new Set<string>();
    const out: RbacRiskFinding[] = [];
    for (const f of findings) {
      const k = `${f.rule}:${f.resource}:${f.verbs.join(",")}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(f);
    }
    return out;
  }

  onMount(() => {
    if (!offline) void runScan();
  });
</script>

<div class="space-y-4">
  <!-- Header with scan control -->
  <Card.Root>
    <Card.Header class="space-y-1 pb-3">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <Card.Title class="text-base">Security Audit</Card.Title>
          <p class="text-xs text-muted-foreground mt-0.5">
            Local-only scan of RBAC roles and pod security posture. Runs against the current
            kubeconfig, no data leaves the machine.
          </p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-[11px] text-muted-foreground">
            Last scan: {relativeTime(lastScanAt)}
          </span>
          <Button
            size="sm"
            variant="outline"
            onclick={runScan}
            disabled={phase === "running" || offline}
          >
            {#if phase === "running"}
              Scanning<LoadingDots />
            {:else}
              {lastScanAt ? "Rescan" : "Scan now"}
            {/if}
          </Button>
        </div>
      </div>
    </Card.Header>
    <Card.Content class="pt-0">
      <button
        type="button"
        class="text-xs text-sky-400 hover:text-sky-300 hover:underline"
        onclick={() => (aboutOpen = !aboutOpen)}
      >
        {aboutOpen ? "Hide" : "Show"} what this audit covers
      </button>
      {#if aboutOpen}
        <div class="mt-2 space-y-2 rounded border border-border bg-muted/30 p-3 text-xs">
          <p>
            <strong>RBAC risk scanner.</strong>
            {RBAC_SCAN_OVERVIEW.summary} Scans {RBAC_SCAN_OVERVIEW.rulesCount} dangerous verb + resource
            combinations from the Kubernetes
            <a
              class="text-sky-400 hover:underline"
              href={RBAC_SCAN_OVERVIEW.docUrl}
              target="_blank"
              rel="noreferrer">RBAC good-practices guide</a
            >.
          </p>
          <p>
            <strong>Pod Security Standards.</strong>
            {PSS_SCAN_OVERVIEW.summary} Checks are derived from the upstream
            <a
              class="text-sky-400 hover:underline"
              href={PSS_SCAN_OVERVIEW.docUrl}
              target="_blank"
              rel="noreferrer">PSS specification</a
            >.
          </p>
          <p class="text-muted-foreground">
            Nothing is installed on the cluster. The scan reads ClusterRoles, Roles, and Pods via
            kubectl, then evaluates them locally.
          </p>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>

  {#if offline}
    <Alert.Root variant="default">
      <Alert.Description>Cluster is offline. Reconnect to run the audit.</Alert.Description>
    </Alert.Root>
  {/if}

  {#if phase === "error" && errorMessage}
    <Alert.Root variant="destructive">
      <Alert.Title>Scan failed</Alert.Title>
      <Alert.Description>
        <pre class="whitespace-pre-wrap text-xs">{errorMessage}</pre>
      </Alert.Description>
    </Alert.Root>
  {/if}

  <!-- RBAC Risk Scanner -->
  <Card.Root>
    <Card.Header class="pb-3">
      <div class="flex items-center justify-between">
        <Card.Title class="text-sm">RBAC Risk Scanner</Card.Title>
        {#if rbacReport}
          <span class="text-[11px] text-muted-foreground">
            {rbacReport.summary.totalRoles} roles scanned
          </span>
        {/if}
      </div>
    </Card.Header>
    <Card.Content class="space-y-3">
      {#if phase === "idle"}
        <p class="text-xs text-muted-foreground">
          Click <strong>Scan now</strong> to evaluate ClusterRoles and Roles for least-privilege violations.
        </p>
      {:else if phase === "running" && !rbacReport}
        <p class="text-xs text-muted-foreground">
          Fetching ClusterRoles and Roles<LoadingDots />
        </p>
      {:else if rbacReport}
        <div class="flex flex-wrap gap-3 text-xs">
          <span class="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 font-mono">
            {rbacReport.summary.criticalCount} critical
          </span>
          <span class="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-mono">
            {rbacReport.summary.highCount} high
          </span>
          <span class="rounded border border-yellow-500/40 bg-yellow-500/10 px-2 py-1 font-mono">
            {rbacReport.summary.mediumCount} medium
          </span>
          <span class="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 font-mono">
            {rbacReport.summary.cleanCount} clean
          </span>
        </div>

        {#if rbacReport.summary.totalRoles === 0}
          <p class="text-xs text-muted-foreground">
            No ClusterRoles or Roles returned. Either the cluster is empty or the current user
            cannot list them.
          </p>
        {:else if criticalRoles.length + highRoles.length + mediumRoles.length === 0}
          <p class="text-xs text-emerald-400">
            Every scanned role is clean. Nothing flagged against the
            {RBAC_SCAN_OVERVIEW.rulesCount} dangerous patterns.
          </p>
        {:else}
          <div class="space-y-1.5">
            {#each [...criticalRoles, ...highRoles, ...mediumRoles].slice(0, 20) as role (roleKey(role))}
              {@const k = roleKey(role)}
              {@const isOpen = expandedRole === k}
              <button
                type="button"
                class="w-full rounded border border-border bg-background/50 p-2 text-left hover:border-foreground/20"
                onclick={() => toggleRole(role)}
              >
                <div class="flex items-center gap-2">
                  <Badge variant="outline" class="text-[10px] {rbacBadgeClass(role.highestRisk)}">
                    {role.highestRisk}
                  </Badge>
                  <span class="font-mono text-xs">
                    {role.kind}{role.namespace ? `/${role.namespace}` : ""}/{role.name}
                  </span>
                  <span class="ml-auto text-[11px] text-muted-foreground">
                    {role.findings.length}
                    {role.findings.length === 1 ? "finding" : "findings"}
                    · score {role.riskScore}
                  </span>
                </div>
                {#if isOpen}
                  <ul class="mt-2 space-y-2 border-t border-border pt-2">
                    {#each dedupeFindings(role.findings) as finding (finding.rule + finding.resource)}
                      {@const doc = RBAC_RULE_CATALOG[finding.rule]}
                      <li class="space-y-1 text-xs">
                        <div class="flex flex-wrap items-center gap-2">
                          <Badge
                            variant="outline"
                            class="text-[10px] {rbacBadgeClass(finding.level)}"
                          >
                            {finding.level}
                          </Badge>
                          <span class="font-medium">
                            {doc?.title ?? finding.rule}
                          </span>
                          <code
                            class="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                          >
                            {finding.resource} · {finding.verbs.join(", ")}
                          </code>
                        </div>
                        <p class="text-muted-foreground">
                          {doc?.why ?? finding.description}
                        </p>
                        {#if doc}
                          <p>
                            <strong class="text-emerald-400">Fix:</strong>
                            <span class="text-muted-foreground">{doc.fix}</span>
                          </p>
                          <a
                            href={doc.docUrl}
                            class="text-[11px] text-sky-400 hover:underline"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Reference
                          </a>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                {/if}
              </button>
            {/each}
            {#if criticalRoles.length + highRoles.length + mediumRoles.length > 20}
              <p class="text-[11px] text-muted-foreground">
                Showing 20 of {criticalRoles.length + highRoles.length + mediumRoles.length} roles with
                findings. Fix the critical ones first.
              </p>
            {/if}
          </div>
        {/if}
      {/if}
    </Card.Content>
  </Card.Root>

  <!-- Pod Security Standards -->
  <Card.Root>
    <Card.Header class="pb-3">
      <div class="flex items-center justify-between">
        <Card.Title class="text-sm">Pod Security Standards</Card.Title>
        {#if pssReport}
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-muted-foreground">
              {pssReport.summary.total} pods scanned
            </span>
            <div
              class="inline-flex items-center rounded border border-border text-[10px] overflow-hidden"
            >
              <button
                type="button"
                class={`px-2 py-1 ${pssLevelFilter === "all" ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50"}`}
                onclick={() => (pssLevelFilter = "all")}
              >
                All
              </button>
              <button
                type="button"
                class={`border-l border-border px-2 py-1 ${pssLevelFilter === "baseline" ? "bg-muted font-medium text-amber-300" : "text-muted-foreground hover:bg-muted/50"}`}
                onclick={() => (pssLevelFilter = "baseline")}
              >
                Baseline
              </button>
              <button
                type="button"
                class={`border-l border-border px-2 py-1 ${pssLevelFilter === "restricted" ? "bg-muted font-medium text-sky-300" : "text-muted-foreground hover:bg-muted/50"}`}
                onclick={() => (pssLevelFilter = "restricted")}
              >
                Restricted
              </button>
            </div>
          </div>
        {/if}
      </div>
    </Card.Header>
    <Card.Content class="space-y-3">
      {#if phase === "idle"}
        <p class="text-xs text-muted-foreground">
          Click <strong>Scan now</strong> to evaluate pods against the Baseline and Restricted profiles.
        </p>
      {:else if phase === "running" && !pssReport}
        <p class="text-xs text-muted-foreground">Fetching pods<LoadingDots /></p>
      {:else if pssReport}
        <div class="flex flex-wrap gap-3 text-xs">
          <span class="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1">
            {pssReport.summary.restrictedCompliant} restricted-compliant
          </span>
          <span class="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1">
            {pssReport.summary.baselineCompliant} baseline-only
          </span>
          <span class="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1">
            {pssReport.summary.privilegedOnly} privileged-only
          </span>
        </div>

        {#if pssReport.summary.total === 0}
          <p class="text-xs text-muted-foreground">
            No pods returned. Either the cluster is empty or the current user cannot list pods.
          </p>
        {:else if filteredFailingPods.length === 0}
          <p class="text-xs text-emerald-400">
            {pssLevelFilter === "all"
              ? "Every pod is Restricted-compliant."
              : `No pods fail the ${pssLevelFilter} profile.`}
          </p>
        {:else}
          <div class="space-y-1.5">
            {#each filteredFailingPods.slice(0, 20) as pod (podKey(pod))}
              {@const k = podKey(pod)}
              {@const isOpen = expandedPod === k}
              <button
                type="button"
                class="w-full rounded border border-border bg-background/50 p-2 text-left hover:border-foreground/20"
                onclick={() => togglePod(pod)}
              >
                <div class="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    class="text-[10px] {pssLevelBadge(pod.maxCompliantLevel)}"
                  >
                    {pod.maxCompliantLevel}
                  </Badge>
                  <span class="font-mono text-xs">{pod.namespace}/{pod.pod}</span>
                  <span class="ml-auto text-[11px] text-muted-foreground">
                    {pod.violations.length}
                    {pod.violations.length === 1 ? "violation" : "violations"}
                  </span>
                </div>
                {#if isOpen}
                  <ul class="mt-2 space-y-2 border-t border-border pt-2">
                    {#each pod.violations as v, i (i)}
                      {@const doc = PSS_CHECK_CATALOG[v.check]}
                      <li class="space-y-1 text-xs">
                        <div class="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" class="text-[10px] {pssBadgeClass(v.level)}">
                            {v.level}
                          </Badge>
                          <span class="font-medium">{doc?.title ?? v.check}</span>
                          <code
                            class="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                          >
                            {v.field}
                          </code>
                        </div>
                        <p class="text-muted-foreground">{doc?.why ?? v.message}</p>
                        {#if doc}
                          <p>
                            <strong class="text-emerald-400">Fix:</strong>
                            <span class="text-muted-foreground">{doc.fix}</span>
                          </p>
                          <a
                            href={doc.docUrl}
                            class="text-[11px] text-sky-400 hover:underline"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Reference
                          </a>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                {/if}
              </button>
            {/each}
            {#if filteredFailingPods.length > 20}
              <p class="text-[11px] text-muted-foreground">
                Showing 20 of {filteredFailingPods.length} pods with violations.
              </p>
            {/if}
          </div>
        {/if}
      {/if}
    </Card.Content>
  </Card.Root>
</div>
