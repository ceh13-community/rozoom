<script lang="ts">
  import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
  import type { PodItem } from "$shared/model/clusters";
  import { filterMetricsForPods, parseTopPodMetricsOutput } from "./model/pod-metrics";
  import type { PodMetricsValue } from "./model/pod-row-adapter";

  interface PodMetricsBoundaryProps {
    clusterId: string;
    pods: Partial<PodItem>[];
    refreshToken: number;
    onMetricsChange: (metrics: Map<string, PodMetricsValue>) => void;
    onMetricsErrorChange: (message: string | null) => void;
    onMetricsLoadingChange: (loading: boolean) => void;
  }

  const {
    clusterId,
    pods,
    refreshToken,
    onMetricsChange,
    onMetricsErrorChange,
    onMetricsLoadingChange,
  }: PodMetricsBoundaryProps =
    $props();

  let lastLoadedKey = $state<string | null>(null);
  let activeLoadId = 0;

  async function loadMetrics(loadId: number) {
    if (!clusterId) return;
    if (loadId === activeLoadId) {
      onMetricsLoadingChange(true);
    }
    try {
      const response = await kubectlRawArgsFront(["top", "pod", "--all-namespaces", "--no-headers"], {
        clusterId,
      });
      if (loadId !== activeLoadId) return;
      if (response.errors) {
        throw new Error(response.errors);
      }
      const allMetrics = parseTopPodMetricsOutput(response.output);
      onMetricsChange(filterMetricsForPods(allMetrics, pods));
      onMetricsErrorChange(null);
    } catch (error) {
      if (loadId !== activeLoadId) return;
      onMetricsChange(new Map());
      onMetricsErrorChange(error instanceof Error ? error.message : "Failed to load pod metrics.");
    } finally {
      if (loadId === activeLoadId) {
        onMetricsLoadingChange(false);
      }
    }
  }

  $effect(() => {
    const key = `${clusterId}:${refreshToken}:${pods.map((pod) => pod.metadata?.uid ?? `${pod.metadata?.namespace ?? "default"}/${pod.metadata?.name ?? "unknown"}`).join(",")}`;
    if (!clusterId || key === lastLoadedKey) return;
    lastLoadedKey = key;
    activeLoadId += 1;
    void loadMetrics(activeLoadId);
  });
</script>
