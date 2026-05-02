<script lang="ts">
  import LoadingDots from "../loading-dots.svelte";
  import type { ConsoleSession } from "./session.svelte";

  interface Props {
    session: ConsoleSession;
    /** Optional heading shown next to the status badge. */
    label?: string;
    /**
     * Empty-state hint shown when the session has never run. Pass only when
     * you want the idle console visible - otherwise an idle session renders
     * nothing so the panel stays quiet until the user triggers an action.
     */
    idleHint?: string;
    /** Cap the console height so long transcripts do not push the page. */
    maxHeightClass?: string;
    /**
     * After a successful run, auto-collapse the transcript so the success
     * state becomes a compact chip (`done | Show output | ×`). Failures
     * always stay expanded so the user sees the error without extra clicks.
     * Default: true.
     */
    autoCollapseOnSuccess?: boolean;
    /** Delay before auto-collapse fires, in ms. Default: 3000. */
    autoCollapseMs?: number;
    /** Fires after the user clicks the close button. */
    onDismiss?: () => void;
  }

  const {
    session,
    label,
    idleHint,
    maxHeightClass = "max-h-48",
    autoCollapseOnSuccess = true,
    autoCollapseMs = 3000,
    onDismiss,
  }: Props = $props();

  const statusLabel: Record<string, string> = {
    idle: "idle",
    running: "running",
    ok: "done",
    fail: "failed",
    canceled: "canceled",
  };

  const statusClass: Record<string, string> = {
    idle: "bg-slate-500/15 text-slate-300 border-slate-500/40",
    running: "bg-amber-500/15 text-amber-300 border-amber-500/40",
    ok: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
    fail: "bg-rose-500/15 text-rose-300 border-rose-500/40",
    canceled: "bg-slate-500/15 text-slate-300 border-slate-500/40",
  };

  // Auto-collapse the transcript once a successful run ends. Deliberately
  // scoped to `ok` only: failures need the output visible so the user can
  // read the error without an extra click.
  let collapseTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    if (!autoCollapseOnSuccess) return;
    if (session.status !== "ok") return;
    if (!session.expanded) return;
    collapseTimer = setTimeout(() => {
      session.setExpanded(false);
    }, autoCollapseMs);
    return () => {
      if (collapseTimer) {
        clearTimeout(collapseTimer);
        collapseTimer = null;
      }
    };
  });

  function dismiss() {
    session.dismiss();
    onDismiss?.();
  }

  // When there is nothing to show, render nothing rather than an empty
  // placeholder - panels should feel quiet until the user acts. The idleHint
  // prop is an explicit opt-in for surfaces that want a visible affordance.
  const shouldRender = $derived.by(() => {
    if (session.dismissed) return false;
    if (session.status === "idle" && !session.output) {
      return Boolean(idleHint);
    }
    return true;
  });

  const terminal = $derived(
    session.status === "ok" || session.status === "fail" || session.status === "canceled",
  );
</script>

{#if shouldRender}
  <div class="space-y-1.5 text-xs">
    <div class="flex flex-wrap items-center gap-2">
      {#if label}
        <span class="font-medium">{label}</span>
      {/if}
      <span
        class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap {statusClass[
          session.status
        ] ?? statusClass.idle}"
      >
        {statusLabel[session.status] ?? session.status}
        {#if session.isRunning}
          <LoadingDots class="text-amber-300" />
        {/if}
      </span>
      {#if session.isRunning}
        <button
          type="button"
          class="text-[11px] text-rose-400 hover:underline"
          onclick={() => session.cancel()}
          title="Send abort signal to the running command"
        >
          Cancel
        </button>
      {/if}
      {#if session.output}
        <button
          type="button"
          class="ml-auto text-[11px] text-sky-400 hover:underline"
          onclick={() => session.toggleExpanded()}
        >
          {session.expanded ? "Hide output" : "Show output"}
        </button>
      {/if}
      {#if terminal}
        <button
          type="button"
          class="text-[11px] text-slate-400 hover:text-slate-200"
          onclick={dismiss}
          title="Dismiss console"
          aria-label="Dismiss console"
        >
          ✕
        </button>
      {/if}
    </div>

    {#if !session.output && session.status === "idle" && idleHint}
      <p class="text-[11px] text-muted-foreground">{idleHint}</p>
    {/if}

    {#if session.output && session.expanded}
      <pre
        class="overflow-auto rounded bg-slate-950/70 p-2 text-[10px] font-mono text-slate-200 whitespace-pre-wrap {maxHeightClass}">{session.output}</pre>
    {/if}
  </div>
{/if}
