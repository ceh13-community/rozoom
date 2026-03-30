<script lang="ts">
  import { STATUS_CLASSES } from "$entities/cluster";
  import { Badge } from "$shared/ui/badge";

  const { podRestarts } = $props();
</script>

<div class="font-medium leading-5 text-slate-800 dark:text-slate-200">Pod restarts</div>
<div class="truncate text-xs font-medium text-slate-500 dark:text-slate-400">
  {podRestarts}
</div>
<Badge class={`min-w-20 justify-center ${podRestarts > 0 ? STATUS_CLASSES.warning : STATUS_CLASSES.ok}`}>
  {podRestarts > 0 ? "Warning" : "Ok"}
</Badge>
