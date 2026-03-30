<script lang="ts">
  import type { ComponentProps } from "svelte";
  import { ArrowUpDownIcon } from "$shared/ui/icons";
  import { Button } from "./index";

  let {
    label,
    variant = "ghost",
    ...restProps
  }: ComponentProps<typeof Button> & { label: string } = $props();
</script>

<Button class="max-w-full justify-start overflow-hidden" {variant} {...restProps}>
  <span class="block max-w-full truncate">{label}</span>
  <ArrowUpDownIcon class="ml-2 shrink-0" />
</Button>
