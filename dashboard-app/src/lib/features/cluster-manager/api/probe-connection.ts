import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import { kubeconfigArgs } from "../model/kubeconfig-context";

export type ConnectionProbeResult = {
  status: "ready" | "auth-issue" | "unreachable";
  latencyMs: number;
  /** Last line kubectl printed to stderr, for the row tooltip. Empty when the API answered. */
  detail?: string;
};

/**
 * Upper bound for one probe. kubectl retries discovery five times inside its own
 * --request-timeout=5s, so a silent server takes ~25 s to fail on its own (measured
 * 25.1 s); the bound only has to catch a credential plugin that never returns.
 * Known limitation: aborting kills kubectl, not a plugin child kubectl spawned.
 */
export const PROBE_TIMEOUT_MS = 35_000;

// `kubectl cluster-info` prints this line only after the API server answered the
// services request. On any failure (refused, timeout, DNS, 401) it still prints
// "To further debug and diagnose cluster problems ..." to stdout and exits 1, so a
// non-empty stdout alone proves nothing.
const CONTROL_PLANE_ANSWERED = /is running at/i;

// stderr shapes measured on the bundled kubectl (3LPAnzex 05/11, reviewer stand 09/11):
// a server that answered 401/403 or a TLS problem, and a credential plugin that failed
// or is missing ("Unable to connect to the server: getting credentials: exec: ...").
// All of them are about credentials, not the network: the fix is on the user's side.
const AUTH_ISSUE = [
  /unauthorized/i,
  /forbidden/i,
  /certificate/i,
  /must be logged in/i,
  /provide credentials/i,
  /getting credentials/i,
];

// Visible one-line reasons, only for failure shapes measured on the bundled kubectl.
// Anything else keeps the raw line in the tooltip only. The detail is kubectl's last
// stderr line, e.g. "The connection to the server 127.0.0.1:1 was refused - did you
// specify the right host or port?" (1.37.2, stand 09/11).
const SHORT_REASONS: Array<[RegExp, string]> = [
  [/connection refused|was refused/i, "Connection refused"],
  [/context deadline exceeded|Client\.Timeout exceeded|i\/o timeout/i, "No answer from the server"],
  [/no such host/i, "Host name not found"],
  [/getting credentials/i, "Credential plugin failed"],
  [/^Gave up after \d+ s:/, "Check timed out"],
];

/** Human-readable reason for a failed probe, or null when the shape was never measured. */
export function shortProbeReason(detail: string | undefined | null): string | null {
  if (!detail) return null;
  return SHORT_REASONS.find(([pattern]) => pattern.test(detail))?.[1] ?? null;
}

/**
 * kubectl prints its "E1109 ... memcache.go" retry lines first and the verdict last
 * ("Unable to connect to the server: ..." or "error: ..."). The last line carries the
 * cause in every measured case.
 */
function lastLine(text: string): string {
  const lines = text
    .replace(/^\[ERROR\] \[[^\]]*\]:\s*/, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines[lines.length - 1] ?? "";
}

/**
 * Asks the API server behind `contextName` whether it answers. This runs the context's
 * credential plugin (exec, OIDC, cloud CLI) if it has one, so callers must only invoke it
 * on an explicit user action, never while a screen is merely being shown.
 *
 * `kubeconfigPath` empty or null means "the file kubectl resolves by default" ($KUBECONFIG
 * or ~/.kube/config), which is where the detected list came from.
 */
export async function probeClusterConnection(
  contextName: string,
  kubeconfigPath: string | null | undefined,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ConnectionProbeResult> {
  const start = performance.now();
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const controller = new AbortController();
  const onOuterAbort = () => {
    controller.abort();
  };
  options.signal?.addEventListener("abort", onOuterAbort, { once: true });
  // Object, not a boolean: the flag is set inside the timer closure, which TypeScript's
  // flow analysis cannot see.
  const timedOut = { value: false };
  const timer = setTimeout(() => {
    timedOut.value = true;
    controller.abort();
  }, timeoutMs);
  try {
    // Array form: a context name or path with spaces stays one argument.
    const result = await kubectlRawArgsFront(
      [
        "cluster-info",
        `--context=${contextName}`,
        ...kubeconfigArgs(kubeconfigPath),
        "--request-timeout=5s",
      ],
      { signal: controller.signal, source: "cluster-manager:check" },
    );
    const latencyMs = Math.round(performance.now() - start);

    // Ready first: exit 0 and the control plane line. Words in stdout (a server URL that
    // happens to contain "certificate") must not turn a live cluster into an auth issue.
    const exitedCleanly = result.code === undefined || result.code === 0;
    if (exitedCleanly && CONTROL_PLANE_ANSWERED.test(result.output)) {
      return { status: "ready", latencyMs };
    }

    const detail = lastLine(result.errors);
    if (AUTH_ISSUE.some((pattern) => pattern.test(result.errors))) {
      return { status: "auth-issue", latencyMs, detail };
    }
    return { status: "unreachable", latencyMs, detail };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - start);
    if (timedOut.value) {
      return {
        status: "unreachable",
        latencyMs,
        detail: `Gave up after ${Math.round(timeoutMs / 1000)} s: kubectl did not return. Its credential plugin may still be running.`,
      };
    }
    // DOMException (the proxy's AbortError) is not an Error in every runtime.
    const message =
      typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error);
    return { status: "unreachable", latencyMs, detail: message };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onOuterAbort);
  }
}
