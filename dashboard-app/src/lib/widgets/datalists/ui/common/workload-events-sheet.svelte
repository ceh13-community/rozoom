<script lang="ts">
  import type { Writable } from "svelte/store";
  import type { WorkloadEvent } from "./workload-events";
  import DetailsEventsList from "./details-events-list.svelte";
  import WorkbenchSheetShell from "./workbench-sheet-shell.svelte";

  interface WorkloadEventsSheetProps {
    embedded?: boolean;
    isOpen: Writable<boolean>;
    title: string;
    targetRef: string;
    events: WorkloadEvent[];
    loading: boolean;
    error: string | null;
    canVerticalCollapse?: boolean;
    isVerticallyCollapsed?: boolean;
    onToggleVerticalCollapse?: () => void;
  }

  const {
    embedded = false,
    isOpen,
    title,
    targetRef,
    events,
    loading,
    error,
    canVerticalCollapse = false,
    isVerticallyCollapsed = false,
    onToggleVerticalCollapse = () => {},
  }: WorkloadEventsSheetProps = $props();

  let isFullscreen = $state(false);
</script>

<WorkbenchSheetShell
  {embedded}
  {isOpen}
  title={title}
  collapsedLabel={targetRef || "Events"}
  standaloneMaxWidthClass="sm:max-w-[70vw]"
  {canVerticalCollapse}
  {isVerticallyCollapsed}
  {onToggleVerticalCollapse}
  {isFullscreen}
  onToggleFullscreen={() => {
    isFullscreen = !isFullscreen;
  }}
>
  <div class="min-h-0 flex-1 overflow-auto p-3">
    <DetailsEventsList {events} {loading} {error} emptyText="No events found." />
  </div>
</WorkbenchSheetShell>
