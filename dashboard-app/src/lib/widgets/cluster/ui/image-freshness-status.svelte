<script lang="ts">
  import { Badge } from "$shared/ui/badge";
  import { STATUS_CLASSES } from "$entities/cluster";
  import type { ImageFreshnessReport } from "$features/check-health/model/types";

  interface Props {
    report: ImageFreshnessReport | null;
  }

  const { report }: Props = $props();

  const summary = $derived(report?.summary ?? null);

  const badgeLabel = $derived.by(() => {
    if (!summary) return "Unknown";
    if (summary.latestTagCount > 0) return `${summary.latestTagCount} :latest`;
    return "OK";
  });

  const statusClass = $derived.by(() => {
    if (!report) return STATUS_CLASSES.unknown;
    if (report.status === "ok") return STATUS_CLASSES.ok;
    if (report.status === "warning") return STATUS_CLASSES.warning;
    if (report.status === "critical") return STATUS_CLASSES.error;
    return STATUS_CLASSES.unknown;
  });
</script>

<div class="pl-1 flex justify-between items-center gap-2 mb-1 mt-1 text-sm">
  <span class="font-medium text-slate-700 dark:text-slate-300">Image hygiene:</span>
  <Badge class={`text-white ${statusClass}`}>
    {badgeLabel}
  </Badge>
</div>
