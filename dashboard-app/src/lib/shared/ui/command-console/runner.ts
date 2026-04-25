/**
 * Run a CLI command against a cluster and stream its invocation line plus
 * stdout and stderr into a ConsoleSession. Returns the raw exec result so
 * callers can branch on exit code / output.
 *
 * Keeps the shell-style `$ <command>` prefix so the output reads like a
 * transcript of a real terminal session: users can copy it verbatim into a
 * bug report and reproduce the action themselves.
 */

import { execCliForCluster, type CliTool } from "$shared/api/cli";
import type { ConsoleSession } from "./session.svelte";

export type ExecResult = {
  code: number;
  stdout: string;
  stderr: string;
  /** Convenience flag: code === 0. */
  success: boolean;
  /** When present, runCommand caught an exception before CLI returned. */
  error?: string;
};

function toExecResult(
  raw: { code: number; stdout: string; stderr: string },
  error?: string,
): ExecResult {
  return { ...raw, success: raw.code === 0, ...(error ? { error } : {}) };
}

export async function runCommand(
  tool: CliTool,
  args: string[],
  clusterId: string,
  session: ConsoleSession,
): Promise<ExecResult> {
  session.append(`$ ${tool} ${args.join(" ")}`);
  if (session.signal?.aborted) {
    session.append("  (canceled before start)");
    return toExecResult({ code: 130, stdout: "", stderr: "aborted" }, "aborted");
  }
  try {
    const raw = await execCliForCluster(tool, args, clusterId);
    if (raw.stdout) session.append(raw.stdout);
    if (raw.stderr) session.append(raw.stderr);
    if (!raw.stdout && !raw.stderr && raw.code === 0) {
      session.append("  (no output)");
    }
    return toExecResult(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    session.append(`  error: ${message}`);
    return toExecResult({ code: 1, stdout: "", stderr: message }, message);
  }
}

/**
 * Convenience wrapper around runCommand that drives a whole session from a
 * list of commands. Stops at the first non-zero exit code, marks the
 * session failed, and returns the index of the failed step. Returns
 * `commands.length` when every step succeeds.
 */
export async function runSequence(
  clusterId: string,
  session: ConsoleSession,
  commands: Array<{ tool: CliTool; args: string[]; note?: string }>,
): Promise<{ success: boolean; stoppedAt: number; lastResult: ExecResult | null }> {
  let lastResult: ExecResult | null = null;
  for (let i = 0; i < commands.length; i += 1) {
    if (session.signal?.aborted) {
      session.append("  (canceled)");
      return { success: false, stoppedAt: i, lastResult };
    }
    const { tool, args, note } = commands[i];
    if (note) session.append(note);
    lastResult = await runCommand(tool, args, clusterId, session);
    if (!lastResult.success || lastResult.code !== 0) {
      return { success: false, stoppedAt: i, lastResult };
    }
  }
  return { success: true, stoppedAt: commands.length, lastResult };
}
