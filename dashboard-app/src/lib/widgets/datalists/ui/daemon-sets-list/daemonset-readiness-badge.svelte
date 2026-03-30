<script lang="ts">
  interface Props {
    ready: number;
    desired: number;
  }

  let { ready, desired }: Props = $props();

  const toneClass = $derived.by(() => {
    if (desired === 0) return "border-slate-500/40 bg-slate-500/15 text-slate-700 dark:text-slate-300";
    if (ready >= desired) {
      return "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
    }
    if (ready === 0) return "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300";
    return "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300";
  });
</script>

<span class={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${toneClass}`}>
  {ready}/{desired}
</span>
