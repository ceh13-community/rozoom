<script lang="ts">
  import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import { DISK_USAGE_HINT, PVC_USAGE_NOTICES, type PvcUsageNotice } from "./pvc-usage-notice";

  interface Props {
    clusterId: string;
    pvcName: string;
    pvcNamespace: string;
  }

  const { clusterId, pvcName, pvcNamespace }: Props = $props();

  let usedBytes = $state<number | null>(null);
  let capacityBytes = $state<number | null>(null);
  let loading = $state(true);
  let notice = $state<PvcUsageNotice | null>(null);

  function formatGiB(bytes: number): string {
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} Mi`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} Gi`;
  }

  async function resolve() {
    loading = true;
    notice = null;
    try {
      // 1. Find pods that mount this PVC
      const podsResult = await kubectlRawArgsFront(
        ["get", "pods", "-n", pvcNamespace, "-o", "json"],
        { clusterId },
      );
      if (podsResult.errors || podsResult.code !== 0) {
        notice = PVC_USAGE_NOTICES.cannotListPods;
        return;
      }

      const pods = JSON.parse(podsResult.output) as {
        items: Array<{
          metadata: { name: string };
          spec: { nodeName?: string; volumes?: Array<{ name: string; persistentVolumeClaim?: { claimName: string } }> };
        }>;
      };

      // Find a pod + node that mounts this PVC
      let targetNode = "";
      for (const pod of pods.items) {
        const mountsPvc = pod.spec.volumes?.some(
          (v) => v.persistentVolumeClaim?.claimName === pvcName,
        );
        if (mountsPvc && pod.spec.nodeName) {
          targetNode = pod.spec.nodeName;
          break;
        }
      }

      if (!targetNode) {
        notice = PVC_USAGE_NOTICES.noPodUsesClaim;
        return;
      }

      // 2. Query kubelet stats summary on that node
      const statsResult = await kubectlRawArgsFront(
        ["get", "--raw", `/api/v1/nodes/${targetNode}/proxy/stats/summary`],
        { clusterId },
      );
      if (statsResult.errors || statsResult.code !== 0) {
        notice = PVC_USAGE_NOTICES.cannotReadNodeStats;
        return;
      }

      const stats = JSON.parse(statsResult.output) as {
        pods: Array<{
          podRef: { namespace: string };
          volume?: Array<{
            pvcRef?: { name: string; namespace: string };
            usedBytes?: number;
            capacityBytes?: number;
          }>;
        }>;
      };

      // Find volume stats matching this PVC
      for (const pod of stats.pods) {
        if (pod.podRef.namespace !== pvcNamespace) continue;
        for (const vol of pod.volume ?? []) {
          if (vol.pvcRef?.name === pvcName && vol.capacityBytes) {
            usedBytes = vol.usedBytes ?? 0;
            capacityBytes = vol.capacityBytes;
            return;
          }
        }
      }

      notice = PVC_USAGE_NOTICES.noStatsForClaim;
    } catch {
      notice = PVC_USAGE_NOTICES.failed;
    } finally {
      loading = false;
    }
  }

  let lastKey = "";
  $effect(() => {
    const key = `${clusterId}/${pvcNamespace}/${pvcName}`;
    if (key === lastKey) return;
    lastKey = key;
    queueMicrotask(() => void resolve());
  });

  const usagePercent = $derived(
    usedBytes !== null && capacityBytes !== null && capacityBytes > 0
      ? Math.round((usedBytes / capacityBytes) * 100)
      : null,
  );

  const barColor = $derived(
    usagePercent === null ? "" :
    usagePercent >= 90 ? "bg-rose-500" :
    usagePercent >= 75 ? "bg-amber-500" :
    "bg-emerald-500"
  );
</script>

<div class="mt-4">
{#if loading}
  <div class="text-xs text-muted-foreground">Checking disk usage<LoadingDots /></div>
{:else if notice?.kind === "error"}
  <div class="flex items-start gap-1.5 text-xs text-destructive" role="status">
    <CircleAlert class="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    <span>{notice.text}</span>
  </div>
{:else if notice}
  <div class="text-xs text-muted-foreground">{notice.text}</div>
{:else if usagePercent !== null && usedBytes !== null && capacityBytes !== null}
  <div class="rounded border bg-muted/10 p-3">
    <div class="mb-1 flex items-center justify-between text-xs">
      <span class="font-medium" title={DISK_USAGE_HINT}>Disk Usage</span>
      <span class={usagePercent >= 90 ? "text-rose-400 font-semibold" : usagePercent >= 75 ? "text-amber-400" : "text-emerald-400"}>
        {usagePercent}%
      </span>
    </div>
    <div class="h-2 w-full overflow-hidden rounded-full bg-slate-700/50">
      <div class={`h-full rounded-full transition-all ${barColor}`} style="width: {usagePercent}%"></div>
    </div>
    <div class="mt-1 flex justify-between text-xs text-muted-foreground">
      <span>{formatGiB(usedBytes)} used</span>
      <span>{formatGiB(capacityBytes)} total</span>
    </div>
  </div>
{/if}
</div>
