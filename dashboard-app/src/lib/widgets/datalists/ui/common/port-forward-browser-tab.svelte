<script lang="ts">
  import { Button } from "$shared/ui/button";
  import Copy from "@lucide/svelte/icons/copy";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Browser from "@lucide/svelte/icons/square-arrow-out-up-right";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Activity from "@lucide/svelte/icons/activity";
  import {
    formatUptime,
    type PortForwardStatus,
    type PortForwardTestResult,
  } from "$shared/lib/port-forward-status";

  type Props = {
    title: string;
    url: string;
    loading?: boolean;
    message?: string | null;
    /** State of the tunnel: badge, uptime and the connection count. Absent for hosts without one. */
    status?: PortForwardStatus | null;
    /** The last lines kubectl printed, newest last. */
    logLines?: readonly string[];
    /** One timed request through the tunnel; the result is shown next to the Test button. */
    onTest?: () => Promise<PortForwardTestResult>;
    onRefresh: () => void;
    onCopyUrl?: () => void;
    onOpenPreview?: () => void;
    previewLabel?: string;
    onOpenExternal?: () => void;
    onStop?: () => void;
    stopBusy?: boolean;
    stopLabel?: string;
  };

  let {
    title,
    url,
    loading = false,
    message = null,
    status = null,
    logLines = [],
    onTest,
    onRefresh,
    onCopyUrl,
    onOpenPreview,
    previewLabel = "Open Web",
    onOpenExternal,
    onStop,
    stopBusy = false,
    stopLabel = "Stop",
  }: Props = $props();

  const BADGE_CLASS: Record<PortForwardStatus["state"], string> = {
    active: "bg-emerald-700 text-white",
    starting: "bg-amber-700 text-white",
    stopped: "bg-slate-600 text-white",
    error: "bg-rose-700 text-white",
  };

  // The uptime ticks once a second while the tunnel runs.
  let now = $state(Date.now());
  $effect(() => {
    if (status?.state !== "active" && status?.state !== "starting") return;
    const timer = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });
  const uptime = $derived.by(() => {
    if (!status?.startedAt) return null;
    const end = status.closedAt ?? now;
    return formatUptime(end - status.startedAt);
  });

  // The HTTP plugin's scope covers http on the local host only; a red refusal on a working
  // https tunnel would mislead, so Test is off for it with the reason next to the button.
  const testUnavailable = $derived(
    url.startsWith("https:") ? "Test checks http forwards only" : null,
  );
  let testing = $state(false);
  let testResult = $state<PortForwardTestResult | null>(null);
  async function runTest() {
    if (!onTest || testing || testUnavailable) return;
    testing = true;
    try {
      testResult = await onTest();
    } finally {
      testing = false;
    }
  }
  const testText = $derived.by(() => {
    if (!testResult) return null;
    if (testResult.status !== null) return `HTTP ${testResult.status} in ${testResult.ms} ms`;
    return `${testResult.error ?? "Failed"} (${testResult.ms} ms)`;
  });

  let logEl = $state<HTMLPreElement | null>(null);
  $effect(() => {
    // Keep the newest line in view as kubectl prints.
    void logLines.length;
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  });
</script>

<div class="flex h-full min-h-0 flex-col">
  <div class="flex items-center justify-between gap-2 border-b px-3 py-2">
    <div class="min-w-0">
      <p class="truncate text-sm font-medium">{title}</p>
      <p class="truncate font-mono text-xs text-muted-foreground">{url}</p>
    </div>
    <div class="flex items-center gap-2">
      {#if onCopyUrl}
        <Button variant="outline" size="sm" onclick={onCopyUrl}>
          <Copy class="h-4 w-4" />
          Copy URL
        </Button>
      {/if}
      {#if onOpenPreview}
        <Button variant="outline" size="sm" onclick={onOpenPreview}>
          <Browser class="h-4 w-4" />
          {previewLabel}
        </Button>
      {/if}
      {#if onOpenExternal}
        <Button variant="outline" size="sm" onclick={onOpenExternal}>
          <ExternalLink class="h-4 w-4" />
          Open external
        </Button>
      {/if}
      {#if onStop}
        <Button variant="destructive" size="sm" onclick={onStop} disabled={stopBusy}>
          {stopBusy ? stopLabel : "Stop"}
        </Button>
      {/if}
      <Button variant="outline" size="sm" onclick={onRefresh} {loading}>
        <RefreshCw class={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        Refresh
      </Button>
    </div>
  </div>
  {#if status}
    <div
      class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 text-xs"
      data-testid="port-forward-status"
    >
      <span class={`rounded px-1.5 py-0.5 font-medium ${BADGE_CLASS[status.state]}`}
        >{status.label}</span
      >
      {#if uptime}
        <span class="text-muted-foreground">{status.closedAt ? "ran" : "up"} {uptime}</span>
      {/if}
      <span
        class="text-muted-foreground"
        title="Lines &quot;Handling connection for &lt;port&gt;&quot; printed by kubectl"
        >{status.connections} {status.connections === 1 ? "connection" : "connections"}</span
      >
      {#if status.detail}
        <span class="truncate text-rose-700 dark:text-rose-400">{status.detail}</span>
      {/if}
      {#if onTest}
        <span class="ml-auto inline-flex items-center gap-2">
          {#if testUnavailable}
            <span class="text-muted-foreground" data-testid="port-forward-test-unavailable"
              >{testUnavailable}</span
            >
          {:else if testText}
            <span
              class={testResult?.ok
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-rose-700 dark:text-rose-400"}
              data-testid="port-forward-test-result">{testText}</span
            >
          {/if}
          <Button
            variant="outline"
            size="sm"
            onclick={runTest}
            disabled={testing || status.state === "stopped" || Boolean(testUnavailable)}
            title={testUnavailable ?? undefined}
          >
            {#if testing}
              <LoaderCircle class="h-4 w-4 animate-spin" />
            {:else}
              <Activity class="h-4 w-4" />
            {/if}
            Test
          </Button>
        </span>
      {/if}
    </div>
  {/if}
  {#if loading}
    <div class="border-b px-3 py-2 text-xs text-muted-foreground">
      <span class="inline-flex items-center gap-1">
        <LoaderCircle class="h-3.5 w-3.5 animate-spin" />
        {message ?? "Opening web..."}
      </span>
    </div>
  {:else if message}
    <div class="border-b px-3 py-2 text-xs text-muted-foreground">{message}</div>
  {/if}
  {#if status}
    <pre
      bind:this={logEl}
      class="max-h-48 overflow-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-xs text-muted-foreground"
      data-testid="port-forward-log"
      aria-label="kubectl port-forward output">{logLines.length
        ? logLines.join("\n")
        : "No output from kubectl yet."}</pre>
  {/if}
</div>
