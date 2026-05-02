import { error as logError } from "@tauri-apps/plugin-log";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import type { ApiServerEndpointCheck, ApiServerHealth } from "../model/types";

const REQUEST_TIMEOUT = "5s";

function isOkResponse(output: string, code?: number): boolean {
  if (code !== 0) return false;
  const trimmed = output.trim().toLowerCase();
  return trimmed.startsWith("ok") || trimmed.includes("check passed");
}

async function fetchApiEndpoint(
  clusterId: string,
  endpoint: "livez" | "readyz",
): Promise<ApiServerEndpointCheck> {
  const result = await kubectlRawFront(
    `get --raw=/${endpoint}?verbose --request-timeout=${REQUEST_TIMEOUT}`,
    { clusterId },
  );

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
