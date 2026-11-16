/**
 * What a failed kubectl call says about reaching the cluster.
 *
 * One vocabulary for the Fleet card badge, the "Cluster unreachable" banner and the
 * Cluster Manager Check badge. Reasons are the visible one-line texts; the raw stderr
 * line stays in `detail` for the Details disclosure.
 */
export type ConnectivityState = "online" | "unreachable" | "auth-expired";

export type ConnectivityVerdict =
  | { state: "online" }
  | { state: "unreachable" | "auth-expired"; reason: string; detail: string };

export const UNKNOWN_FAILURE_REASON = "No answer from the server";

type Rule = [RegExp, { state: ConnectivityState; reason?: string }];

// Order matters: a credential plugin failure can mention "Unauthorized", and a 401
// arrives both as "error: You must be logged in ... (Unauthorized)" and as
// "Error from server (Unauthorized)", so both auth rules run before the generic
// "the server answered" rule.
const RULES: Rule[] = [
  [
    /getting credentials|exec plugin/i,
    { state: "auth-expired", reason: "Credential plugin failed" },
  ],
  [
    /unauthorized|must be logged in|provide credentials/i,
    { state: "auth-expired", reason: "Credentials expired or rejected" },
  ],
  // Any "Error from server (...)" means the API server answered: Forbidden (a
  // view-only token), NotFound, a webhook error. That is the page's error to show,
  // not a connectivity state.
  [/error from server|\bforbidden\b/i, { state: "online" }],
  [/x509|certificate/i, { state: "unreachable", reason: "Certificate not trusted" }],
  [/connection refused|was refused/i, { state: "unreachable", reason: "Connection refused" }],
  [/no route to host/i, { state: "unreachable", reason: "No route to the cluster address" }],
  [/no such host/i, { state: "unreachable", reason: "Host name not found" }],
];

/**
 * kubectl prints its "E1109 ... memcache.go" retry lines first and the verdict last
 * ("Unable to connect to the server: ..." or "error: ..."). The last line carries the
 * cause in every measured case.
 */
export function lastStderrLine(text: string | null | undefined): string {
  const lines = (text ?? "")
    .replace(/^\[ERROR\] \[[^\]]*\]:\s*/, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines[lines.length - 1] ?? "";
}

/** Classifies the stderr of a kubectl call that failed. */
export function classifyKubectlFailure(stderr: string | null | undefined): ConnectivityVerdict {
  const text = stderr ?? "";
  const detail = lastStderrLine(text);
  for (const [pattern, verdict] of RULES) {
    if (!pattern.test(text)) continue;
    if (verdict.state === "online") return { state: "online" };
    return { state: verdict.state, reason: verdict.reason ?? UNKNOWN_FAILURE_REASON, detail };
  }
  return { state: "unreachable", reason: UNKNOWN_FAILURE_REASON, detail };
}
