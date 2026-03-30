import { kubectlRawFront } from "$shared/api/kubectl-proxy";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function getNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function normalizeAvailableBytesFromSummary(summary: unknown): number | null {
  if (!isObject(summary)) return null;

  const node = summary["node"];
  if (!isObject(node)) return null;

  const fs = node["fs"];
  if (!isObject(fs)) return null;

  const a1 = getNumber(fs["availableBytes"]);
  if (a1 !== null) return a1;

  const available = fs["available"];
  if (isObject(available)) {
    const a2 = getNumber(available["bytes"]);
    if (a2 !== null) return a2;
  }

  const a3 = getNumber(available);
  if (a3 !== null) return a3;

  const a4 = getNumber(fs["available_bytes"]);
  if (a4 !== null) return a4;

  return null;
}

export async function diskFromKubeletSummary(
  clusterId: string,
  nodeName: string,
): Promise<{ name: string; freeGiB: number } | null> {
  const sumRes = await kubectlRawFront(`get --raw /api/v1/nodes/${nodeName}/proxy/stats/summary`, {
    clusterId,
  });

  if (sumRes.errors.length) return null;

  const summary = JSON.parse(sumRes.output) as unknown;
  const availableBytes = normalizeAvailableBytesFromSummary(summary);
  if (availableBytes === null) return null;

  const freeGiB = Number((availableBytes / 1024 / 1024 / 1024).toFixed(2));
  return { name: nodeName, freeGiB };
}
