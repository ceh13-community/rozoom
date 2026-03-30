<script lang="ts">
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import { STATUS_CLASSES } from "$entities/cluster";
  import type { ApiServerHealth } from "$features/check-health/model/types";
  import { Badge } from "$shared/ui/badge";

  interface Props {
    health: ApiServerHealth | null;
  }

  const { health }: Props = $props();

  let isOpen = $state(false);

  const statusLabel = $derived.by(() => {
    if (!health) return "Unknown";
    if (health.status === "ok") return "Live & Ready OK";
    if (health.status === "warning") return "Live OK / Ready FAILED";
    if (health.status === "critical") return "Unreachable";
    return "Unknown";
  });

  const liveText = $derived.by(() => (health?.live.ok ? "OK" : "FAILED"));
  const readyText = $derived.by(() => (health?.ready.ok ? "OK" : "FAILED"));
  const statusClass = $derived.by(() => {
    if (!health) return STATUS_CLASSES.unknown;
    if (health.status === "ok") return STATUS_CLASSES.ok;
    if (health.status === "warning") return STATUS_CLASSES.warning;
    if (health.status === "critical") return STATUS_CLASSES.error;
    return STATUS_CLASSES.unknown;
  });
</script>

<div class="pl-1 text-sm flex justify-between items-center gap-3 mb-1 mt-1">
  <span
    class="font-medium leading-5 text-slate-800 dark:text-slate-200"
    title="Quick /livez and /readyz health checks for kube-apiserver.">API server live/ready:</span
  >

  <Popover.Root bind:open={isOpen}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Badge {...props} class={`min-w-28 justify-center text-white ${statusClass} cursor-pointer`}>
          {statusLabel}
        </Badge>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content class="w-96 max-h-80 overflow-y-auto">
      <div class="mb-2 text-[11px] text-muted-foreground/90">
        This check reflects the documented kube-apiserver `/livez` and `/readyz` endpoints. It is a
        direct health-endpoint probe, unlike latency or alert summaries.
      </div>
      <div class="flex flex-col gap-2 text-xs">
        <div>
          <div class="font-medium">/livez: {liveText}</div>
          <pre class="whitespace-pre-wrap text-[11px] text-muted-foreground">
{health?.live.output || health?.live.error || "No response"}
          </pre>
        </div>
        <div>
          <div class="font-medium">/readyz: {readyText}</div>
          <pre class="whitespace-pre-wrap text-[11px] text-muted-foreground">
{health?.ready.output || health?.ready.error || "No response"}
          </pre>
        </div>
      </div>
    </Popover.Content>
  </Popover.Root>
</div>
