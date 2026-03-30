import { kubectlRawFront } from "$shared/api/kubectl-proxy";

type Summary = {
  node?: {
    nodeName?: string;
    cpu?: { usageNanoCores?: number };
    memory?: { workingSetBytes?: number };
    fs?: { availableBytes?: number; capacityBytes?: number; usedBytes?: number };
    runtime?: { imageFs?: { availableBytes?: number; capacityBytes?: number; usedBytes?: number } };
  };
};

function toPercent(used: number, total: number): string {
  if (!total || total <= 0) return "0%";

  const p = Math.round((used / total) * 100);

  return `${Math.max(0, Math.min(100, p))}%`;
}

// NOTE: Without node allocatable/capacity we can't make perfect %.
// We'll compute CPU% as N/A if we can't estimate. Memory% also can be N/A.
export async function getKubeletSummaryForNode(
  clusterId: string,
  nodeName: string,
): Promise<Summary> {
  const { output } = await kubectlRawFront(
    `get --raw /api/v1/nodes/${nodeName}/proxy/stats/summary`,
    { clusterId },
  );

  return JSON.parse(output) as Summary;
}

export function extractDiskFreeGiB(summary: Summary): number | null {
  const fs = summary.node?.fs ?? summary.node?.runtime?.imageFs;
  const avail = fs?.availableBytes;

  if (typeof avail !== "number") return null;

  return avail / 1024 / 1024 / 1024;
}

// Optional: best-effort disk percent if capacity exists
export function extractDiskPercent(summary: Summary): string | null {
  const fs = summary.node?.fs ?? summary.node?.runtime?.imageFs;
  const cap = fs?.capacityBytes;
  const used = fs?.usedBytes;

  if (typeof cap !== "number" || typeof used !== "number") return null;

  return toPercent(used, cap);
}
