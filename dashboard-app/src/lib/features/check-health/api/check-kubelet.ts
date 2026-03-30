import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { getClusterNodesNames } from "$shared/api/tauri";
import { checkResponseStatus } from "$shared/lib/parsers";
import {
  getFeatureCapability,
  markFeatureCapability,
  markFeatureCapabilityFromReason,
  shouldSkipFeatureProbe,
} from "../model/feature-capability-cache";

interface CheckKubeletResponse {
  error?: string;
  lastSync: string;
  status: { nodeName: string; result: number }[];
  title: string;
  url?: string;
}

const CHECK_KUBELET_CACHE_MS = 60_000;
const KUBELET_FEATURE_ID = "metrics-source:api";

const cachedReports = new Map<string, { data: CheckKubeletResponse; fetchedAt: number }>();

function buildCachedUnavailableResponse(clusterId: string, reason: string): CheckKubeletResponse {
  markFeatureCapabilityFromReason(clusterId, KUBELET_FEATURE_ID, reason);
  const report = {
    error: reason,
    lastSync: new Date().toISOString(),
    status: [{ nodeName: "", result: -1 }],
    title: "Kubelet",
  };
  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}

export function resetCheckKubeletCache() {
  cachedReports.clear();
}

export const checkKubelet = async (
  clusterId: string,
  nodesNames?: string[],
  options?: { force?: boolean },
): Promise<CheckKubeletResponse> => {
  const cached = cachedReports.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CHECK_KUBELET_CACHE_MS) {
    return cached.data;
  }

  if (
    !options?.force &&
    shouldSkipFeatureProbe(clusterId, KUBELET_FEATURE_ID, {
      statuses: ["unsupported", "forbidden", "unreachable", "unavailable", "misconfigured"],
    })
  ) {
    const capability = getFeatureCapability(clusterId, KUBELET_FEATURE_ID);
    if (capability?.reason) {
      return buildCachedUnavailableResponse(clusterId, capability.reason);
    }
  }

  let targetNodesNames: string[] = [];

  if (nodesNames && nodesNames.length > 0) {
    targetNodesNames = nodesNames;
  } else {
    const nodes = await getClusterNodesNames(clusterId);

    if (!nodes.length) {
      const report = {
        error: "Cluster has no nodes",
        lastSync: new Date().toISOString(),
        status: [{ nodeName: "", result: -1 }],
        title: "Kubelet",
      };
      cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
      return report;
    }

    targetNodesNames = nodes;
  }

  const results: { nodeName: string; result: number }[] = [];
  let hasError = false;
  const errorMessages: string[] = [];

  for (const nodeName of targetNodesNames) {
    try {
      const kubeletHealth = await kubectlRawFront(
        `get --raw /api/v1/nodes/${nodeName}/proxy/healthz`,
        { clusterId },
      );

      if (kubeletHealth.errors.length > 0) {
        const statusCode = checkResponseStatus(kubeletHealth.errors);
        results.push({ nodeName, result: statusCode });
        hasError = true;
        errorMessages.push(kubeletHealth.errors);
        continue;
      }

      const output = kubeletHealth.output.trim().toLowerCase();
      if (output === "ok" || output.startsWith("ok")) {
        results.push({ nodeName, result: 1 });
      } else {
        results.push({ nodeName, result: 0 });
        hasError = true;
        errorMessages.push(
          `Kubelet healthz returned unexpected response on node ${nodeName}: ${kubeletHealth.output.slice(0, 100)}`,
        );
      }
    } catch (err) {
      results.push({ nodeName, result: -1 });
      hasError = true;
      errorMessages.push(String(err));
    }
  }

  const response: CheckKubeletResponse = {
    lastSync: new Date().toISOString(),
    status: results,
    title: "Kubelet",
  };

  if (targetNodesNames.length > 0 && !hasError) {
    const lastNode = targetNodesNames[targetNodesNames.length - 1];
    response.url = `/api/v1/nodes/${lastNode}/proxy/metrics/`;
  }

  if (hasError) {
    response.error = errorMessages.join("\n");
    markFeatureCapabilityFromReason(clusterId, KUBELET_FEATURE_ID, response.error);
  } else {
    markFeatureCapability(clusterId, KUBELET_FEATURE_ID, { status: "available" });
  }

  cachedReports.set(clusterId, { data: response, fetchedAt: Date.now() });
  return response;
};
