/**
 * Rune-based state container for an inline command console.
 *
 * Every install / action flow in the dashboard that shells out to helm or
 * kubectl benefits from showing the same contract: which command is
 * running right now, its status, and its streaming output. This module
 * owns those primitives so panels do not each re-implement the
 * status/output/expanded triplet.
 *
 * Usage:
 *
 *   const session = createConsoleSession();
 *   session.start();
 *   await runCommand("helm", ["upgrade", "--install", ...], clusterId, session);
 *   if (allOk) session.succeed(); else session.fail();
 *
 * Consumers render state through <CommandConsole bind:session /> or by
 * reading `session.status`, `session.output`, `session.expanded`.
 */

import type { ConsoleStatus } from "./types";

export type ConsoleSession = ReturnType<typeof createConsoleSession>;

export function createConsoleSession() {
  let status = $state<ConsoleStatus>("idle");
  let output = $state("");
  let expanded = $state(false);
  let dismissed = $state(false);
  let abort: AbortController | null = null;

  return {
    get status() {
      return status;
    },
    get output() {
      return output;
    },
    get expanded() {
      return expanded;
    },
    get dismissed() {
      return dismissed;
    },
    get signal() {
      return abort?.signal;
    },
    get isRunning() {
      return status === "running";
    },

    /**
     * Open a new run: clear previous output, mark running, arm an abort
     * controller, auto-expand the console so the user sees progress.
     * Clears any prior dismissal so the console surfaces again.
     */
    start() {
      output = "";
      status = "running";
      expanded = true;
      dismissed = false;
      abort = new AbortController();
    },

    /** Append raw text (stdout/stderr/banner) to the live output stream. */
    append(chunk: string) {
      if (!chunk) return;
      output += chunk.endsWith("\n") ? chunk : `${chunk}\n`;
    },

    /** Mark the session as successfully completed. Idempotent. */
    succeed() {
      status = "ok";
    },

    /** Mark the session as failed. Idempotent. */
    fail() {
      status = "fail";
    },

    /**
     * Explicit cancellation from the UI or component unmount. Fires the
     * abort signal so in-flight runner helpers can bail out early. The
     * controller is kept around so `session.signal.aborted` stays true for
     * any subsequent reads by sequence-runner loops.
     */
    cancel() {
      abort?.abort();
      status = "canceled";
    },

    toggleExpanded() {
      expanded = !expanded;
    },

    setExpanded(next: boolean) {
      expanded = next;
    },

    /**
     * Hide the console entirely after a terminal status. The transcript is
     * kept in memory so a subsequent `start()` reuses the same session
     * without stale output being briefly visible.
     */
    dismiss() {
      dismissed = true;
      expanded = false;
    },

    /** Reset everything to initial state (used by consumers on refresh). */
    reset() {
      abort?.abort();
      abort = null;
      status = "idle";
      output = "";
      expanded = false;
      dismissed = false;
    },
  };
}
