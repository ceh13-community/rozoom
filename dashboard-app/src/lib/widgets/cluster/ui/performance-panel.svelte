<script lang="ts">
  import { onMount } from "svelte";
  import {
    discoverPrometheusService,
    fetchApiServerRed,
    fetchCpuThrottling,
    type ApiServerRedEntry,
    type ApiServerRedReport,
    type PrometheusEndpoint,
  } from "$features/performance-obs";
  import type {
    CpuThrottlingEntry,
    CpuThrottlingReport,
  } from "$features/workloads-management/model/cpu-throttling";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
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

  type Phase = "idle" | "discovering" | "scanning" | "done" | "error";

  let phase = $state<Phase>("idle");
  let errorMessage = $state<string | null>(null);
  let lastScanAt = $state<number | null>(null);
  let endpoint = $state<PrometheusEndpoint | null>(null);
  let redReport = $state<ApiServerRedReport | null>(null);
  let throttlingReport = $state<CpuThrottlingReport | null>(null);
  let window = $state<"5m" | "15m" | "1h">("5m");

  const ROW_LIMIT = 15;

  function relativeTime(ts: number | null): string {
    if (!ts) return "never";
    const diffMs = Date.now() - ts;
    if (diffMs < 60_000) return "just now";
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  }

  function redBadgeClass(s: ApiServerRedEntry["status"]): string {
    switch (s) {
      case "critical":
        return "bg-rose-500/15 text-rose-300 border-rose-500/40";
      case "degraded":
        return "bg-amber-500/15 text-amber-300 border-amber-500/40";
      default:
        return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
    }
  }

  function throttlingBadgeClass(s: CpuThrottlingEntry["status"]): string {
    switch (s) {
      case "critical":
        return "bg-rose-500/15 text-rose-300 border-rose-500/40";
      case "warning":
        return "bg-amber-500/15 text-amber-300 border-amber-500/40";
      default:
        return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
    }
  }

  async function runScan() {
    if (offline) return;
    errorMessage = null;
    try {
      if (!endpoint) {
        phase = "discovering";
        endpoint = await discoverPrometheusService(clusterId);
        if (!endpoint) {
          phase = "done";
          return;
        }
      }
      phase = "scanning";
      const [red, throttling] = await Promise.all([
        fetchApiServerRed(clusterId, endpoint, window),
        fetchCpuThrottling(clusterId, endpoint, window),
      ]);
      redReport = red;
      throttlingReport = throttling;
      lastScanAt = Date.now();
      phase = "done";
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      phase = "error";
    }
  }

  function goToHelmCatalog() {
    const next = new URL($page.url);
    next.searchParams.set("workload", "helmcatalog");
    void goto(next.pathname + next.search);
  }

  async function rediscover() {
    endpoint = null;
    redReport = null;
    throttlingReport = null;
    await runScan();
  }

  const topThrottling = $derived<CpuThrottlingEntry[]>(
    (throttlingReport?.entries ?? []).filter((e) => e.throttlingPercent > 0).slice(0, ROW_LIMIT),
  );

  onMount(() => {
    if (!offline) void runScan();
  });
</script>

<div class="space-y-4">
  <Card.Root>
    <Card.Header class="pb-3">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <Card.Title class="text-base">Performance Observability</Card.Title>
          <p class="text-xs text-muted-foreground mt-0.5">
            RED metrics for kube-apiserver and CFS throttling per container. Queries Prometheus
            through the K8s
            <a
              href="https://kubernetes.io/docs/tasks/extend-kubernetes/http-proxy-access-api/"
              target="_blank"
              rel="noreferrer"
              class="text-sky-400 hover:underline">service proxy</a
            > - no port-forward required.
          </p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <label class="flex items-center gap-1 text-[11px] text-muted-foreground">
            window
            <select
              bind:value={window}
              class="h-7 rounded border border-border bg-background px-2 text-xs"
            >
              <option value="5m">5m</option>
              <option value="15m">15m</option>
              <option value="1h">1h</option>
            </select>
          </label>
          <span class="text-[11px] text-muted-foreground">
            Last scan: {relativeTime(lastScanAt)}
          </span>
          <Button
            size="sm"
            variant="outline"
            onclick={runScan}
            disabled={phase === "scanning" || phase === "discovering" || offline}
          >
            {#if phase === "discovering"}
              Discovering<LoadingDots />
            {:else if phase === "scanning"}
              Scanning<LoadingDots />
            {:else}
              {lastScanAt ? "Rescan" : "Scan now"}
            {/if}
          </Button>
        </div>
      </div>
    </Card.Header>
  </Card.Root>

  {#if offline}
    <Alert.Root>
      <Alert.Description>Cluster is offline. Reconnect to scan.</Alert.Description>
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

  {#if phase === "done" && !endpoint}
    <Card.Root class="border-amber-500/40 bg-amber-500/5">
      <Card.Header class="pb-3">
        <Card.Title class="text-sm text-amber-300">Prometheus not detected</Card.Title>
      </Card.Header>
      <Card.Content class="space-y-2 text-xs">
        <p>
          No service matching <code>*-prometheus</code>, <code>prometheus-operated</code>, or
          <code>prometheus-server</code> was found across all namespaces.
        </p>
        <p>
          Install
          <a
            href="https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack"
            target="_blank"
            rel="noreferrer"
            class="text-sky-400 hover:underline">kube-prometheus-stack</a
          >
          from the Helm Catalog to get apiserver metrics, cAdvisor scraping, and Alertmanager out of
          the box.
        </p>
        <div class="flex gap-2 pt-1">
          <Button size="sm" variant="outline" onclick={goToHelmCatalog}>Open Helm Catalog</Button>
          <Button size="sm" variant="ghost" onclick={rediscover}>Rediscover</Button>
        </div>
      </Card.Content>
    </Card.Root>
  {/if}

  {#if endpoint}
    <Alert.Root>
      <Alert.Description class="text-xs">
        Using Prometheus at
        <code>
          {endpoint.namespace}/{endpoint.service}:{endpoint.port}
        </code>
        ({endpoint.flavor}).
        <button type="button" class="ml-2 text-sky-400 hover:underline" onclick={rediscover}
          >Use a different one</button
        >
      </Alert.Description>
    </Alert.Root>
  {/if}

  <!-- RED metrics -->
  {#if endpoint}
    <Card.Root>
      <Card.Header class="pb-3">
        <div class="flex items-center justify-between">
          <Card.Title class="text-sm">RED Metrics - kube-apiserver</Card.Title>
          <a
            href="https://grafana.com/blog/2018/08/02/the-red-method-how-to-instrument-your-services/"
            target="_blank"
            rel="noreferrer"
            class="text-[11px] text-sky-400 hover:underline">RED method</a
          >
        </div>
        <p class="text-[11px] text-muted-foreground">
          Rate, errors, and p95/p99 latency per (verb, resource, scope). Thresholds follow the
          <a
            href="https://sre.google/sre-book/monitoring-distributed-systems/"
            target="_blank"
            rel="noreferrer"
            class="text-sky-400 hover:underline">Four Golden Signals</a
          >: critical &gt;5% errors or &gt;5s p95, degraded &gt;1% errors or &gt;1s p95.
        </p>
      </Card.Header>
      <Card.Content class="space-y-2">
        {#if phase === "scanning" && !redReport}
          <p class="text-xs text-muted-foreground">Running PromQL<LoadingDots /></p>
        {:else if redReport}
          <div class="flex flex-wrap gap-3 text-xs">
            <span class="rounded border border-border bg-background px-2 py-1 font-mono">
              {redReport.summary.totalRate} req/s total
            </span>
            <span
              class="rounded border px-2 py-1 font-mono {redReport.summary.avgErrorPercent > 1
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'}"
            >
              avg err {redReport.summary.avgErrorPercent}%
            </span>
            <span
              class="rounded border px-2 py-1 font-mono {redReport.summary.avgP95LatencyMs > 1000
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'}"
            >
              avg p95 {redReport.summary.avgP95LatencyMs}ms
            </span>
            <span
              class="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 font-mono"
            >
              {redReport.summary.healthyCount} healthy
            </span>
            <span class="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-mono">
              {redReport.summary.degradedCount} degraded
            </span>
            <span class="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 font-mono">
              {redReport.summary.criticalCount} critical
            </span>
          </div>

          {#if redReport.entries.length === 0}
            <p class="text-xs text-muted-foreground">
              No apiserver traffic in the last {window}. Either the cluster is idle or the
              Prometheus scrape is not hitting apiserver endpoints. Verify the ServiceMonitor for
              <code>kubernetes-apiservers</code> exists.
            </p>
          {:else}
            <div class="space-y-1">
              {#each redReport.entries.slice(0, ROW_LIMIT) as entry (`${entry.verb}/${entry.resource}/${entry.scope}`)}
                <div
                  class="flex items-center gap-2 rounded border border-border bg-background/50 p-2 text-xs"
                >
                  <Badge variant="outline" class="text-[10px] {redBadgeClass(entry.status)}">
                    {entry.status}
                  </Badge>
                  <span class="font-mono text-[11px]">
                    {entry.verb}
                    {entry.resource}
                    <span class="text-muted-foreground">({entry.scope})</span>
                  </span>
                  <span class="ml-auto text-[11px] text-muted-foreground">
                    rate
                    <span class="font-mono text-foreground">{entry.totalRate}/s</span>
                    · err
                    <span class="font-mono text-foreground">{entry.errorPercent}%</span>
                    · p95
                    <span class="font-mono text-foreground">{entry.p95LatencyMs}ms</span>
                    · p99
                    <span class="font-mono text-foreground">{entry.p99LatencyMs}ms</span>
                  </span>
                </div>
              {/each}
              {#if redReport.entries.length > ROW_LIMIT}
                <p class="text-[11px] text-muted-foreground">
                  Showing top {ROW_LIMIT} of {redReport.entries.length} (verb, resource) rows sorted
                  by error rate then latency.
                </p>
              {/if}
            </div>
          {/if}
        {/if}
      </Card.Content>
    </Card.Root>

    <!-- CPU throttling -->
    <Card.Root>
      <Card.Header class="pb-3">
        <div class="flex items-center justify-between">
          <Card.Title class="text-sm">CPU Throttling</Card.Title>
          <a
            href="https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/#how-pods-with-resource-limits-are-run"
            target="_blank"
            rel="noreferrer"
            class="text-[11px] text-sky-400 hover:underline">CFS quota</a
          >
        </div>
        <p class="text-[11px] text-muted-foreground">
          When a container hits its CPU limit, the Linux CFS scheduler throttles it. Metrics come
          from cAdvisor (<code>container_cpu_cfs_throttled_periods_total</code> /
          <code>container_cpu_cfs_periods_total</code>). Thresholds: &ge;5% warning, &ge;25%
          critical (common industry guidance).
        </p>
      </Card.Header>
      <Card.Content class="space-y-2">
        {#if phase === "scanning" && !throttlingReport}
          <p class="text-xs text-muted-foreground">Running PromQL<LoadingDots /></p>
        {:else if throttlingReport}
          <div class="flex flex-wrap gap-3 text-xs">
            <span class="rounded border border-border bg-background px-2 py-1 font-mono">
              {throttlingReport.summary.totalContainers} containers
            </span>
            <span class="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-mono">
              {throttlingReport.summary.throttledContainers} throttled
            </span>
            <span class="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 font-mono">
              {throttlingReport.summary.criticalCount} critical
            </span>
            <span class="rounded border border-border bg-muted px-2 py-1 font-mono">
              avg {throttlingReport.summary.avgThrottlingPercent}%
            </span>
          </div>

          {#if topThrottling.length === 0}
            <p class="text-xs text-emerald-400">
              No throttling detected in the last {window}. Containers are either idle or have
              headroom against their CPU limits.
            </p>
          {:else}
            <div class="space-y-1">
              {#each topThrottling as entry (`${entry.namespace}/${entry.pod}/${entry.container}`)}
                <div class="rounded border border-border bg-background/50 p-2 text-xs space-y-1">
                  <div class="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      class="text-[10px] {throttlingBadgeClass(entry.status)}"
                    >
                      {entry.status}
                    </Badge>
                    <span class="font-mono text-[11px]">
                      {entry.namespace}/{entry.pod}/{entry.container}
                    </span>
                    <span class="ml-auto font-mono text-[11px] text-foreground">
                      {entry.throttlingPercent}% throttled
                    </span>
                  </div>
                  {#if entry.recommendation}
                    <p class="text-muted-foreground">
                      <strong class="text-emerald-400">Fix:</strong>
                      {entry.recommendation}
                    </p>
                  {:else}
                    <p class="text-muted-foreground text-[11px]">
                      Usage <span class="font-mono text-foreground"
                        >{entry.cpuUsageMillicores}m</span
                      >
                      / limit
                      <span class="font-mono text-foreground">{entry.cpuLimitMillicores}m</span>
                    </p>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        {/if}
      </Card.Content>
    </Card.Root>

    <!-- SLO tracking placeholder -->
    <Card.Root class="border-dashed">
      <Card.Header class="pb-3">
        <Card.Title class="text-sm">SLO / Error Budget Tracking</Card.Title>
      </Card.Header>
      <Card.Content class="text-xs text-muted-foreground space-y-2">
        <p>
          SLOs depend on what <em>your</em> service considers good. ROZOOM ships the underlying
          burn-rate model (based on the
          <a
            href="https://sre.google/workbook/alerting-on-slos/"
            target="_blank"
            rel="noreferrer"
            class="text-sky-400 hover:underline">SRE Workbook</a
          >) but a generic "cluster-wide SLO" is misleading. A per-service SLO editor is the missing
          piece.
        </p>
        <p class="text-[11px]">
          In the meantime, look at the apiserver RED section above - persistent p95 &gt;1s or error
          rate &gt;1% burns budget for any availability SLO above 99.0%.
        </p>
      </Card.Content>
    </Card.Root>
  {/if}
</div>
