<script lang="ts">
  interface Props {
    status: string;
  }

  let { status }: Props = $props();

  const toneClass = $derived.by(() => {
    const normalized = status.toLowerCase();
    if (normalized.includes("complete") || normalized.includes("succeeded")) {
      return "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
    }
    if (normalized.includes("failed")) {
      return "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300";
    }
    if (normalized.includes("running") || normalized.includes("active")) {
      return "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300";
    }
    return "border-slate-500/40 bg-slate-500/15 text-slate-700 dark:text-slate-300";
  });
</script>

<span class={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${toneClass}`}>
  {status}
</span>
