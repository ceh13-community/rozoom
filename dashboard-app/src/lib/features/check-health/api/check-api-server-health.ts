import { error as logError } from "@tauri-apps/plugin-log";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import type { ApiServerEndpointCheck, ApiServerHealth } from "../model/types";

const REQUEST_TIMEOUT = "5s";

function isOkResponse(output: string, code?: number): boolean {
  if (code !== 0) return false;
  const trimmed = output.trim().toLowerCase();
  return trimmed.startsWith("ok") || trimmed.includes("check passed");
}

// Identify a kubelet/api-server "endpoint does not exist" response. The
// `/readyz?verbose` body enumerates every sub-check, any of which may
// include a 404 for an unrelated reason (e.g. a verbose line like
// "[-]poststarthook/ping failed: reason withheld (err: 404 Not Found ...)").
// That verbose output must NOT trigger the /healthz fallback - it means
// readyz is actually reachable and reporting a sub-probe failure.
//
// Only fire on the two K8s-specific sentinels that mean "the raw GET
// returned a NotFound verb at the HTTP layer":
//   - "Error from server (NotFound): ..." (kubectl format)
//   - "the server could not find the requested resource" (client-go prefix)
// And explicitly reject payloads that look like verbose enumerations.
function isNotFoundError(errors: string): boolean {
  const lower = errors.toLowerCase();
  if (lower.includes("[-]") || lower.includes("[+]")) return false;
  if (lower.includes("the server could not find the requested resource")) return true;
  if (lower.includes("error from server (notfound)")) return true;
  return false;
}

async function fetchApiEndpoint(
  clusterId: string,
  endpoint: "livez" | "readyz",
): Promise<ApiServerEndpointCheck> {
  const result = await kubectlRawFront(
    `get --raw=/${endpoint}?verbose --request-timeout=${REQUEST_TIMEOUT}`,
    { clusterId },
  );

  if (
    !isOkResponse(result.output, result.code) &&
    isNotFoundError(result.errors || result.output)
  ) {
    const fallback = await kubectlRawFront(
      `get --raw=/healthz --request-timeout=${REQUEST_TIMEOUT}`,
      { clusterId },
    );
    const fallbackOk = isOkResponse(fallback.output, fallback.code);
    return {
      ok: fallbackOk,
      output: fallbackOk
        ? `${fallback.output.trim()} (via /healthz fallback)`
        : fallback.output.trim(),
      error: fallbackOk ? undefined : fallback.errors || fallback.output.trim() || "Unreachable",
    };
  }

  const ok = isOkResponse(result.output, result.code);
  const errorMessage = ok ? undefined : result.errors || result.output.trim() || "Unreachable";

  if (!ok && errorMessage) {
    await logError(`API server ${endpoint} check failed: ${errorMessage}`);
  }

  return {
    ok,
    output: result.output.trim(),
    error: errorMessage,
  };
}

export async function checkApiServerHealth(clusterId: string): Promise<ApiServerHealth> {
  const [live, ready] = await Promise.all([
    fetchApiEndpoint(clusterId, "livez"),
    fetchApiEndpoint(clusterId, "readyz"),
  ]);

  let status: ApiServerHealth["status"] = "unknown";

  if (!live.ok) {
    status = "critical";
  } else if (!ready.ok) {
    status = "warning";
  } else {
    status = "ok";
  }

  return {
    live,
    ready,
    status,
    updatedAt: Date.now(),
  };
}
