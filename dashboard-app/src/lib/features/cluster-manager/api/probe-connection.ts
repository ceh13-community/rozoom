import { kubectlRawFront } from "$shared/api/kubectl-proxy";

export type ConnectionProbeResult = {
  status: "ready" | "auth-issue" | "unreachable";
  latencyMs: number;
};

export async function probeClusterConnection(
  contextName: string,
  kubeconfigPath: string,
): Promise<ConnectionProbeResult> {
  const start = performance.now();
  try {
    const result = await kubectlRawFront(
      `cluster-info --context=${contextName} --kubeconfig=${kubeconfigPath} --request-timeout=5s`,
    );
    const latencyMs = Math.round(performance.now() - start);
    const output = `${result.output} ${result.errors}`.toLowerCase();

    if (
      output.includes("unauthorized") ||
      output.includes("forbidden") ||
      output.includes("certificate")
    ) {
      return { status: "auth-issue", latencyMs };
    }

    if (result.errors.trim() && !result.output.trim()) {
      return { status: "unreachable", latencyMs };
    }

    return { status: "ready", latencyMs };
  } catch {
    return { status: "unreachable", latencyMs: Math.round(performance.now() - start) };
  }
}
