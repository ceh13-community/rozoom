<script lang="ts">
  interface Props {
    pods: string;
  }

  let { pods }: Props = $props();

  const parsed = $derived.by(() => {
    const match = /^(\d+)\/(\d+)$/.exec(pods.trim());
    if (!match) return { ready: 0, desired: 0, valid: false };
    return {
      ready: Number.parseInt(match[1], 10),
      desired: Number.parseInt(match[2], 10),
      valid: true,
    };
  });

  const toneClass = $derived.by(() => {
    if (!parsed.valid || parsed.desired === 0) {
      return "border-slate-500/40 bg-slate-500/15 text-slate-700 dark:text-slate-300";
    }
    if (parsed.ready >= parsed.desired) {
      return "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
    }
    if (parsed.ready === 0) return "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300";
    return "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300";
  });
</script>

<span class={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${toneClass}`}>
  {pods}
</span>
