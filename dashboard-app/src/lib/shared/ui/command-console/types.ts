/**
 * Status of a long-running command sequence shown inline with a console.
 *
 *   idle    - nothing has run in this session yet
 *   running - a command is in-flight; the console streams stdout/stderr
 *   ok      - every command in the session returned code 0
 *   fail    - at least one command failed; the console holds the evidence
 *   canceled - the user aborted before a terminal result
 */
export type ConsoleStatus = "idle" | "running" | "ok" | "fail" | "canceled";

export type ConsoleSessionSnapshot = {
  status: ConsoleStatus;
  output: string;
  expanded: boolean;
};
