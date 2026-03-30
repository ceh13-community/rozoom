<script lang="ts">
  interface Props {
    suspend: string;
  }

  let { suspend }: Props = $props();

  const isSuspended = $derived.by(() => suspend.toLowerCase() === "yes" || suspend.toLowerCase() === "true");
  const toneClass = $derived.by(() =>
    isSuspended
      ? "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300"
      : "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  );
</script>

<span class={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${toneClass}`}>
  {suspend}
</span>
