<script lang="ts">
  import { STATUS_CLASSES } from "$entities/cluster";
  import { countPressuresByNodeStatus } from "$features/check-health";
  import type { ClusterHealthChecks } from "$features/check-health";
  import { Badge } from "$shared/ui/badge";

  const { checks }: { checks: ClusterHealthChecks | null } = $props();

  const pressuresCount = $derived(countPressuresByNodeStatus(checks));
</script>

<div class="text-slate-700 dark:text-slate-300">Nodes</div>
<div class="truncate text-gray-500 text-xs">
  {checks?.nodes?.summary.count.ready ?? 0}/{checks?.nodes?.summary.count.total ?? 0}
  {#if pressuresCount > 0}, {pressuresCount} pressures{/if}
</div>
<Badge class={checks?.nodes?.summary.className || STATUS_CLASSES.unknown}>
  {checks?.nodes?.summary.status ?? "Unknown"}
</Badge>
