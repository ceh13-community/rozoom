<script lang="ts">
  import { onDestroy } from "svelte";
  import { kubectlRawFront } from "$shared/api/kubectl-proxy";
  import Cpu from "@lucide/svelte/icons/cpu";
  import HardDrive from "@lucide/svelte/icons/hard-drive";
  import MemoryStick from "@lucide/svelte/icons/memory-stick";

  interface Props {
    clusterId: string;
    resourceRef: string;
    resourceType: "pod" | "node";
  }

  const { clusterId, resourceRef, resourceType }: Props = $props();

  type PodResources = { cpuLimitMilli: number; memLimitMi: number };

  type Metrics = {
    cpu: string;
    cpuPercent: string;
    memory: string;
    memoryPercent: string;
    disk?: string;
    diskPercent?: string;
  };

  const POLL_INTERVAL = 30_000;

  let metrics = $state<Metrics | null>(null);
  let loading = $state(true);
  let errorMsg = $state<string | null>(null);
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  function parseMilli(val: string): number {
    if (val.endsWith("m")) return parseInt(val, 10) || 0;
    if (val.endsWith("n")) return (parseInt(val, 10) || 0) / 1_000_000;
    const n = parseFloat(val);
    return Number.isFinite(n) ? n * 1000 : 0;
  }

  function parseMi(val: string): number {
    if (val.endsWith("Mi")) return parseInt(val, 10) || 0;
    if (val.endsWith("Gi")) return (parseFloat(val) || 0) * 1024;
    if (val.endsWith("Ki")) return (parseInt(val, 10) || 0) / 1024;
    return parseInt(val, 10) || 0;
  }

  function parseTopOutput(output: string): Metrics {
    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const metricsLine = lines.find((line, index) => index > 0 && !/^name\s+/i.test(line));
    if (!metricsLine) throw new Error("No metrics line");
    const parts = metricsLine.split(/\s+/);
    if (parts.length < 3) throw new Error("Unexpected output");
    // Node: name cpu cpu% memory memory% (5 parts)
    // Pod:  name cpu memory (3 parts, no percentages)
    if (parts.length >= 5) {
      return {
        cpu: parts[1] ?? "-",
        cpuPercent: parts[2] ?? "-",
        memory: parts[3] ?? "-",
        memoryPercent: parts[4] ?? "-",
      };
    }
    // Percentages computed from pod limits/requests in fetchMetrics
    return {
      cpu: parts[1] ?? "-",
      cpuPercent: "",
      memory: parts[2] ?? "-",
      memoryPercent: "",
    };
  }

  function buildCommand(): string {
    if (resourceType === "node") {
      return `top node ${resourceRef}`;
    }
    const parts = resourceRef.split("/");
    if (parts.length === 2) {
      return `top pod ${parts[1]} -n ${parts[0]}`;
    }
    return `top pod ${resourceRef}`;
  }

  let podResources: PodResources | null = null;

  async function fetchPodResources() {
    if (resourceType !== "pod" || podResources) return;
    try {
      const parts = resourceRef.split("/");
      const ns = parts.length === 2 ? parts[0] : "default";
      const name = parts.length === 2 ? parts[1] : resourceRef;
      const response = await kubectlRawFront(`get pod ${name} -n ${ns} -o json`, { clusterId });
      if (response.errors || response.code !== 0) return;
      const pod = JSON.parse(response.output) as {
        spec?: { containers?: Array<{ resources?: { limits?: Record<string, string>; requests?: Record<string, string> } }> };
      };
      let cpuLimitMilli = 0;
      let memLimitMi = 0;
      for (const c of pod.spec?.containers ?? []) {
        const cpu = c.resources?.limits?.cpu ?? c.resources?.requests?.cpu;
        const mem = c.resources?.limits?.memory ?? c.resources?.requests?.memory;
        if (cpu) cpuLimitMilli += parseMilli(cpu);
        if (mem) memLimitMi += parseMi(mem);
      }
      if (cpuLimitMilli > 0 || memLimitMi > 0) {
        podResources = { cpuLimitMilli, memLimitMi };
      }
    } catch { /* ignore */ }
  }

  async function fetchNodeDisk() {
    if (!metrics || resourceType !== "node") return;
    try {
      const response = await kubectlRawFront(
        `get --raw /api/v1/nodes/${resourceRef}/proxy/stats/summary`,
        { clusterId },
      );
      if (response.errors || response.code !== 0) return;
      const stats = JSON.parse(response.output) as {
        node?: { fs?: { availableBytes?: number; capacityBytes?: number } };
      };
      const fs = stats.node?.fs;
      if (fs?.capacityBytes && fs.capacityBytes > 0) {
        const usedBytes = fs.capacityBytes - (fs.availableBytes ?? 0);
        const usedPct = Math.round((usedBytes / fs.capacityBytes) * 100);
        const freeGi = ((fs.availableBytes ?? 0) / (1024 ** 3)).toFixed(1);
        const totalGi = (fs.capacityBytes / (1024 ** 3)).toFixed(1);
        metrics.disk = `${freeGi}Gi free / ${totalGi}Gi`;
        metrics.diskPercent = `${usedPct}%`;
      }
    } catch { /* ignore */ }
  }

  async function fetchMetrics() {
    try {
      const cmd = buildCommand();
      const response = await kubectlRawFront(cmd, { clusterId });
      if (response.errors || response.code !== 0) {
        metrics = null;
        errorMsg = "Metrics unavailable";
        return;
      }
      metrics = parseTopOutput(response.output || "");
      if (resourceType === "pod" && metrics) {
        // Compute % from limits/requests
        await fetchPodResources();
        if (podResources) {
          if (podResources.cpuLimitMilli > 0) {
            const cpuPct = Math.min(100, Math.round((parseMilli(metrics.cpu) / podResources.cpuLimitMilli) * 100));
            metrics.cpuPercent = `${cpuPct}%`;
          }
          if (podResources.memLimitMi > 0) {
            const memPct = Math.min(100, Math.round((parseMi(metrics.memory) / podResources.memLimitMi) * 100));
            metrics.memoryPercent = `${memPct}%`;
          }
        }
      }
      if (resourceType === "node" && metrics) {
        await fetchNodeDisk();
      }
      errorMsg = null;
    } catch {
      metrics = null;
      errorMsg = "Metrics unavailable";
    } finally {
      loading = false;
    }
  }

  function startPolling() {
    stopPolling();
    void fetchMetrics();
    pollTimer = setInterval(() => void fetchMetrics(), POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  $effect(() => {
    if (clusterId && resourceRef) {
      startPolling();
    }
    return () => stopPolling();
  });

  onDestroy(() => stopPolling());

  function cpuPercentNum(pct: string): number {
    const n = parseInt(pct, 10);
    return Number.isFinite(n) ? n : 0;
  }

  function memPercentNum(pct: string): number {
    const n = parseInt(pct, 10);
    return Number.isFinite(n) ? n : 0;
  }

  function barColor(pct: number): string {
    if (pct >= 90) return "bg-rose-500";
    if (pct >= 70) return "bg-amber-500";
    return "bg-emerald-500";
  }
</script>

<div class="mt-3">
{#if loading}
  <div class="flex items-center gap-2 rounded border border-slate-700 bg-slate-900/60 px-2.5 py-1.5 text-xs text-slate-500">
    <Cpu class="h-3 w-3" />
    <span>Loading metrics...</span>
  </div>
{:else if metrics}
  <div class="flex items-center gap-3 rounded border border-slate-700 bg-slate-900/60 px-2.5 py-1.5 text-xs">
    <div class="flex items-center gap-1.5" title="CPU: {metrics.cpu}{metrics.cpuPercent ? ` (${metrics.cpuPercent})` : ''}">
      <Cpu class="h-3 w-3 text-slate-400" />
      <span class="text-slate-300">{metrics.cpu}</span>
      {#if metrics.cpuPercent}
        <div class="h-1.5 w-12 rounded-full bg-slate-700">
          <div
            class="h-1.5 rounded-full transition-all {barColor(cpuPercentNum(metrics.cpuPercent))}"
            style="width: {Math.min(100, cpuPercentNum(metrics.cpuPercent))}%"
          ></div>
        </div>
        <span class="text-slate-500">{metrics.cpuPercent}</span>
      {/if}
    </div>
    <div class="flex items-center gap-1.5" title="Memory: {metrics.memory}{metrics.memoryPercent ? ` (${metrics.memoryPercent})` : ''}">
      <MemoryStick class="h-3 w-3 text-slate-400" />
      <span class="text-slate-300">{metrics.memory}</span>
      {#if metrics.memoryPercent}
        <div class="h-1.5 w-12 rounded-full bg-slate-700">
          <div
            class="h-1.5 rounded-full transition-all {barColor(memPercentNum(metrics.memoryPercent))}"
            style="width: {Math.min(100, memPercentNum(metrics.memoryPercent))}%"
          ></div>
        </div>
        <span class="text-slate-500">{metrics.memoryPercent}</span>
      {/if}
    </div>
    {#if metrics.disk && metrics.diskPercent}
      <div class="flex items-center gap-1.5" title="Disk: {metrics.disk} ({metrics.diskPercent} used)">
        <HardDrive class="h-3 w-3 text-slate-400" />
        <span class="text-slate-300">{metrics.disk}</span>
        <div class="h-1.5 w-12 rounded-full bg-slate-700">
          <div
            class="h-1.5 rounded-full transition-all {barColor(memPercentNum(metrics.diskPercent))}"
            style="width: {Math.min(100, memPercentNum(metrics.diskPercent))}%"
          ></div>
        </div>
        <span class="text-slate-500">{metrics.diskPercent}</span>
      </div>
    {/if}
  </div>
{:else}
  <div class="flex items-center gap-2 rounded border border-dashed border-slate-700 px-2.5 py-1.5 text-xs text-slate-500">
    <Cpu class="h-3 w-3" />
    <span>{errorMsg ?? "No metrics available"}</span>
  </div>
{/if}
</div>
