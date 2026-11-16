<script lang="ts">
  import { formatContactTime, type ClusterConnectivity } from "$shared/model/cluster-connectivity";
  import { Button } from "$shared/ui/button";
  import { ChevronDown, KeyRound, LoaderCircle, Unlink } from "$shared/ui/icons";

  interface Props {
    clusterName: string;
    connectivity: ClusterConnectivity;
    /** "waiting": nothing answered yet and the page has been loading for a while. */
    mode: "disconnected" | "waiting";
    /** Set when the page still shows rows loaded before the cluster dropped. */
    showingDataFrom?: number | null;
    /** The page below stays, frozen, with whatever it had cached (Pods). */
    listFrozen?: boolean;
    onRetry: () => void;
  }

  const {
    clusterName,
    connectivity,
    mode,
    showingDataFrom = null,
    listFrozen = false,
    onRetry,
  }: Props = $props();

  let detailsOpen = $state(false);
  const detailsId = $props.id();

  const isAuth = $derived(mode === "disconnected" && connectivity.state === "auth-expired");
  const title = $derived(
    mode === "waiting"
      ? "Still trying to reach the cluster"
      : isAuth
        ? "Auth expired"
        : "Cluster unreachable",
  );
  const body = $derived.by(() => {
    if (mode === "waiting") return `${clusterName} has not answered yet.`;
    if (showingDataFrom !== null) return `Showing data from ${formatContactTime(showingDataFrom)}.`;
    if (isAuth) {
      return listFrozen
        ? "The cluster rejected your credentials, so the list is not updated."
        : "The cluster rejected your credentials, so there is no data to show.";
    }
    return listFrozen
      ? `${clusterName} did not answer, so the list is not updated.`
      : `${clusterName} did not answer, so there is no data to show.`;
  });
  const reason = $derived(mode === "disconnected" ? connectivity.reason : null);
  const footer = $derived.by(() => {
    if (mode === "waiting") return null;
    if (isAuth)
      return "Sign in again in your terminal (for example aws sso login), then click Retry.";
    if (connectivity.reason === "Certificate not trusted") {
      return "Check the certificate-authority entry in your kubeconfig.";
    }
    return "Check the server: address in your kubeconfig, then your VPN or network.";
  });
  const tone = $derived(
    mode === "waiting"
      ? "border-slate-400/60 bg-slate-50 text-slate-900 dark:bg-slate-800/60 dark:text-slate-100"
      : isAuth
        ? "border-amber-500/60 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
        : "border-rose-500/60 bg-rose-50 text-rose-950 dark:bg-rose-950/40 dark:text-rose-100",
  );
</script>

<!-- role="alert" announces the banner once when it appears; later text changes
     inside the polite region do not interrupt and focus is never moved. -->
<div
  class="mb-3 rounded-md border px-4 py-3 text-sm {tone}"
  role="alert"
  data-testid="cluster-unreachable-banner"
  data-mode={mode}
  data-state={connectivity.state}
>
  <div class="flex items-center gap-2 font-semibold">
    {#if mode === "waiting"}
      <LoaderCircle class="h-4 w-4 animate-spin" aria-hidden="true" />
    {:else if isAuth}
      <KeyRound class="h-4 w-4" aria-hidden="true" />
    {:else}
      <Unlink class="h-4 w-4" aria-hidden="true" />
    {/if}
    <span>{title}</span>
  </div>
  <div aria-live="polite">
    <p class="mt-1">{body}</p>
    {#if reason}
      <p class="mt-0.5">Reason: {reason}.</p>
    {/if}
    {#if mode === "disconnected" && connectivity.checkedAt !== null && !connectivity.checking}
      <p class="mt-0.5 text-xs opacity-80">
        Checked at {formatContactTime(connectivity.checkedAt)}
      </p>
    {/if}
  </div>
  <div class="mt-2 flex flex-wrap items-center gap-2">
    <Button size="sm" onclick={onRetry} disabled={connectivity.checking}>
      {#if connectivity.checking}
        <LoaderCircle class="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Checking
      {:else}
        Retry
      {/if}
    </Button>
    {#if mode === "disconnected" && connectivity.detail}
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={detailsOpen}
        aria-controls={detailsId}
        onclick={() => (detailsOpen = !detailsOpen)}
      >
        Details
        <ChevronDown
          class="h-3.5 w-3.5 transition-transform {detailsOpen ? 'rotate-180' : ''}"
          aria-hidden="true"
        />
      </Button>
    {/if}
  </div>
  {#if detailsOpen && connectivity.detail}
    <pre
      id={detailsId}
      class="mt-2 whitespace-pre-wrap break-all rounded bg-black/5 p-2 font-mono text-xs select-text dark:bg-white/10">{connectivity.detail}</pre>
  {/if}
  {#if footer}
    <p class="mt-2 text-xs opacity-80">{footer}</p>
  {/if}
</div>
