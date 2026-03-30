<script lang="ts">
  import { Badge } from "$shared/ui/badge";
  import { selectClusterDrift } from "$features/fleet-drift";
  import * as Popover from "$shared/ui/popover";

  interface Props {
    clusterId: string;
  }

  const { clusterId }: Props = $props();

  const drift$ = $derived(selectClusterDrift(clusterId));
  const snapshot = $derived($drift$);

  const severityColor = $derived.by(() => {
    if (!snapshot) return "bg-slate-500";
    if (snapshot.severity === "critical") return "bg-rose-600";
    if (snapshot.severity === "warning") return "bg-amber-600";
    return "bg-emerald-600";
  });

  const driftedItems = $derived(
    snapshot?.drifts.filter((d) => d.isDrifted) ?? [],
  );
</script>

{#if snapshot && snapshot.driftCount > 0}
  <Popover.Root>
    <Popover.Trigger>
      <Badge class="text-white {severityColor} cursor-pointer text-[10px] h-5 px-1.5 whitespace-nowrap shrink-0">
        {snapshot.driftCount} drift{snapshot.driftCount > 1 ? "s" : ""}
      </Badge>
    </Popover.Trigger>
    <Popover.Content class="w-80" sideOffset={8}>
      <div class="text-sm font-semibold mb-2">Configuration Drift</div>
      <div class="text-xs text-muted-foreground mb-3">
        This cluster deviates from fleet majority in {snapshot.driftCount} dimension{snapshot.driftCount > 1 ? "s" : ""}.
      </div>
      <div class="space-y-2">
        {#each driftedItems as item (item.dimension)}
          {@const sevBorder = item.dimensionSeverity === "critical" ? "border-rose-300 bg-rose-50" : item.dimensionSeverity === "high" ? "border-amber-300 bg-amber-50" : "border-sky-200 bg-sky-50"}
          <div class="flex items-start justify-between gap-2 rounded-md border {sevBorder} px-2.5 py-1.5 text-xs">
            <div>
              <div class="font-medium text-slate-900 flex items-center gap-1.5">
                {item.label}
                <span class="rounded px-1 py-0 text-[9px] font-semibold uppercase {item.dimensionSeverity === 'critical' ? 'bg-rose-200 text-rose-800' : item.dimensionSeverity === 'high' ? 'bg-amber-200 text-amber-800' : 'bg-sky-200 text-sky-800'}">
                  {item.dimensionSeverity}
                </span>
              </div>
              <div class="text-slate-700 mt-0.5">
                This: <span class="font-semibold">{item.clusterValue}</span>
                · Fleet: <span class="font-semibold">{item.fleetMajority}</span>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </Popover.Content>
  </Popover.Root>
{:else if snapshot}
  <Badge class="text-white bg-emerald-600 text-[10px] h-5 px-1.5 whitespace-nowrap shrink-0">
    aligned
  </Badge>
{/if}
