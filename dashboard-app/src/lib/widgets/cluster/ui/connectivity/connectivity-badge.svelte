<script lang="ts">
  import { formatContactTime, type ClusterConnectivity } from "$shared/model/cluster-connectivity";
  import { KeyRound, LoaderCircle, Unlink } from "$shared/ui/icons";

  interface Props {
    connectivity: ClusterConnectivity;
  }

  const { connectivity }: Props = $props();

  // Checking wins only while nothing is known yet or a Retry runs on a failed
  // cluster: a background check on a live cluster must not flicker the badge.
  const view = $derived.by(() => {
    const lastAnswer =
      connectivity.lastContactAt !== null
        ? `Last answer: ${formatContactTime(connectivity.lastContactAt)}`
        : null;
    if (connectivity.checking && connectivity.state !== "online") {
      return {
        kind: "checking",
        text: "Checking",
        tooltip: "Asking the cluster",
        className: "bg-slate-500 text-white border-transparent",
      };
    }
    switch (connectivity.state) {
      case "online":
        return {
          kind: "online",
          text: "Online",
          tooltip: lastAnswer ?? "The cluster answered",
          className: "bg-transparent text-emerald-700 border-emerald-500/70 dark:text-emerald-300",
        };
      case "unreachable":
        return {
          kind: "unreachable",
          text: "Unreachable",
          tooltip: [connectivity.reason, lastAnswer].filter(Boolean).join(". "),
          className: "bg-rose-700 text-white border-transparent",
        };
      case "auth-expired":
        return {
          kind: "auth-expired",
          text: "Auth expired",
          tooltip: `Your sign-in did not work: ${connectivity.reason ?? "credentials rejected"}`,
          className: "bg-amber-600 text-white border-transparent",
        };
      default:
        return null;
    }
  });
</script>

{#if view}
  <span
    class="inline-flex h-5 shrink-0 cursor-help items-center gap-1 rounded-md border px-1.5 text-xs font-semibold uppercase {view.className}"
    title={view.tooltip}
    data-testid="cluster-connectivity-badge"
    data-state={view.kind}
  >
    {#if view.kind === "checking"}
      <LoaderCircle class="h-3 w-3 animate-spin" aria-hidden="true" />
    {:else if view.kind === "online"}
      <span class="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true"></span>
    {:else if view.kind === "unreachable"}
      <Unlink class="h-3 w-3" aria-hidden="true" />
    {:else}
      <KeyRound class="h-3 w-3" aria-hidden="true" />
    {/if}
    {view.text}
  </span>
{/if}
