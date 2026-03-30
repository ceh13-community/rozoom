<script lang="ts">
  import { STATUS_CLASSES } from "$entities/cluster";
  import { Badge } from "$shared/ui/badge";

  let { cronJobCount, cronJobsHealth } = $props();
  const criticalCount = $derived(cronJobsHealth?.summary.critical ?? 0);
  const warningCount = $derived(
    (cronJobsHealth?.summary.warning ?? 0) + (cronJobsHealth?.summary.critical ?? 0),
  );
  const hasWarning = $derived(warningCount > 0);
  const hasCritical = $derived(criticalCount > 0);
  const statusLabel = $derived(
    cronJobsHealth?.error
      ? "Data unavailable"
      : hasCritical
        ? `${criticalCount} critical`
        : hasWarning
          ? `${warningCount} warnings`
          : "OK",
  );
  const badgeClass = $derived(
    cronJobsHealth?.error
      ? STATUS_CLASSES.warning
      : hasCritical
        ? STATUS_CLASSES.error
        : hasWarning
          ? STATUS_CLASSES.warning
          : STATUS_CLASSES.ok,
  );
</script>

<div class="text-slate-700 dark:text-slate-300">Cron jobs</div>
<div class="truncate text-gray-500 text-xs">
  {cronJobCount}
</div>
<Badge class={badgeClass}>
  {statusLabel}
</Badge>
