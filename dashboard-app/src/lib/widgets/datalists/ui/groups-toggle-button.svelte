<script lang="ts">
  import { Button } from "$shared/ui/button";

  type Props = { visible: boolean; label: string; onclick: () => void };
  const { visible, label, onclick }: Props = $props();
</script>

<!--
  The Collapse/Expand groups button keeps its place in the toolbar in every view mode.
  Rendering it only in grouped views made the toolbar wider there: it wrapped, the filter
  moved onto its own row and everything below jumped down when a grouping was chosen.
  Hidden it keeps its width (one width for both labels), takes no clicks and no focus.
-->
<Button
  variant="outline"
  size="sm"
  class={`min-w-[8.5rem] justify-center ${visible ? "" : "invisible"}`}
  aria-hidden={visible ? undefined : "true"}
  tabindex={visible ? undefined : -1}
  disabled={!visible}
  data-testid="groups-toggle"
  {onclick}
>
  {label}
</Button>
