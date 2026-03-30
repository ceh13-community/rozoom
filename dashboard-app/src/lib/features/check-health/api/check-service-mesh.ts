import { error as logError } from "@tauri-apps/plugin-log";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import type { ServiceMeshReport } from "../model/types";

const CACHE_MS = 60 * 1000;
const cachedReports = new Map<string, { data: ServiceMeshReport; fetchedAt: number }>();

const ISTIO_CRD = "virtualservices.networking.istio.io";
const LINKERD_CRD = "serviceprofiles.linkerd.io";

export async function checkServiceMesh(
  clusterId: string,
  options?: { force?: boolean },
): Promise<ServiceMeshReport> {
  const cached = cachedReports.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.data;
  }

  let errorMessage: string | undefined;
  let meshType: "istio" | "linkerd" | "none" = "none";

  try {
    const result = await kubectlRawFront(`api-resources --no-headers -o name`, { clusterId });
    if (result.errors && result.code !== 0) {
      errorMessage = result.errors || "Failed to fetch API resources.";
      await logError(`Service mesh check failed: ${errorMessage}`);
    } else {
      const resources = result.output.split("\n").map((l) => l.trim());
      if (resources.includes(ISTIO_CRD)) {
        meshType = "istio";
      } else if (resources.includes(LINKERD_CRD)) {
        meshType = "linkerd";
      }
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to fetch API resources.";
    await logError(`Service mesh check failed: ${errorMessage}`);
  }

  const detected = meshType !== "none";
  const status = errorMessage ? "unknown" : detected ? "ok" : "unknown";

  const report: ServiceMeshReport = {
    status,
    detected,
    meshType,
    updatedAt: Date.now(),
  };

  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
