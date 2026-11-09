import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";

export type ConnectionProbeResult = {
  status: "ready" | "auth-issue" | "unreachable";
  latencyMs: number;
  /** First line kubectl printed to stderr, for the row tooltip. Empty when the API answered. */
  detail?: string;
};

// `kubectl cluster-info` prints this line only after the API server answered the
// services request. On any failure (refused, timeout, DNS, 401) it still prints
// "To further debug and diagnose cluster problems ..." to stdout and exits 1, so a
// non-empty stdout alone proves nothing.
const CONTROL_PLANE_ANSWERED = /is running at/i;

// Visible one-line reasons, only for failure shapes measured on the bundled kubectl
// (ready-badge-check.txt, 05/11/2026). Anything else keeps the raw line in the tooltip only.
const SHORT_REASONS: Array<[RegExp, string]> = [
  [/connection refused/i, "Connection refused"],
  [/context deadline exceeded/i, "No answer within 5 s"],
  [/no such host/i, "Host name not found"],
];

/** Human-readable reason for a failed probe, or null when the shape was never measured. */
export function shortProbeReason(detail: string | undefined | null): string | null {
  if (!detail) return null;
  return SHORT_REASONS.find(([pattern]) => pattern.test(detail))?.[1] ?? null;
}

function firstLine(text: string): string {
  return (
    text
      .replace(/^\[ERROR\] \[[^\]]*\]:\s*/, "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  );
}

/**
 * Asks the API server behind `contextName` whether it answers. This runs the context's
 * credential plugin (exec, OIDC, cloud CLI) if it has one, so callers must only invoke it
 * on an explicit user action, never while a screen is merely being shown.
 */
export async function probeClusterConnection(
  contextName: string,
  kubeconfigPath: string,
): Promise<ConnectionProbeResult> {
  const start = performance.now();
  try {
    // Array form: a context name or path with spaces stays one argument.
    const result = await kubectlRawArgsFront([
      "cluster-info",
      `--context=${contextName}`,
      `--kubeconfig=${kubeconfigPath}`,
      "--request-timeout=5s",
    ]);
    const latencyMs = Math.round(performance.now() - start);
    const output = `${result.output} ${result.errors}`.toLowerCase();

    if (
      output.includes("unauthorized") ||
      output.includes("forbidden") ||
      output.includes("certificate")
    ) {
      return { status: "auth-issue", latencyMs, detail: firstLine(result.errors) };
    }

    const exitedCleanly = result.code === undefined || result.code === 0;
    if (!exitedCleanly || !CONTROL_PLANE_ANSWERED.test(result.output)) {
      return { status: "unreachable", latencyMs, detail: firstLine(result.errors) };
    }

    return { status: "ready", latencyMs };
  } catch (error) {
    return {
      status: "unreachable",
      latencyMs: Math.round(performance.now() - start),
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
