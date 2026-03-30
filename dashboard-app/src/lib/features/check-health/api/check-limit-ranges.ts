import { error as logError } from "@tauri-apps/plugin-log";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import type { LimitRangesItem, LimitRangesReport, LimitRangesStatus } from "../model/types";

const CACHE_MS = 60 * 1000;
const cachedReports = new Map<string, { data: LimitRangesReport; fetchedAt: number }>();

function parseLines(raw: string): LimitRangesItem[] {
  const items: LimitRangesItem[] = [];
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;

    const namespace = parts[0];
    const name = parts[1];
    items.push({ namespace, name });
  }

  return items;
}

function computeStatus(items: LimitRangesItem[]): LimitRangesStatus {
  if (items.length === 0) return "warning";
  return "ok";
}

export async function checkLimitRanges(
  clusterId: string,
  options?: { force?: boolean },
): Promise<LimitRangesReport> {
  const cached = cachedReports.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.data;
  }

  let errorMessage: string | undefined;
  let items: LimitRangesItem[] = [];

  try {
    const result = await kubectlRawFront(
      "get limitranges --all-namespaces --no-headers -o custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name",
      { clusterId },
    );
    if (result.errors || result.code !== 0) {
      const isNoResources = result.errors.includes("No resources found");
      if (!isNoResources) {
        errorMessage = result.errors || "Failed to fetch limit ranges.";
        await logError(`Limit ranges check failed: ${errorMessage}`);
      }
    } else {
      items = parseLines(result.output);
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to fetch limit ranges.";
    await logError(`Limit ranges check failed: ${errorMessage}`);
  }

  const namespacesWithLimits = new Set(items.map((item) => item.namespace)).size;
  const status: LimitRangesStatus = errorMessage ? "unknown" : computeStatus(items);

  const summary = {
    status,
    message:
      status === "ok"
        ? `${items.length} limit range${items.length !== 1 ? "s" : ""} across ${namespacesWithLimits} namespace${namespacesWithLimits !== 1 ? "s" : ""}`
        : status === "warning"
          ? "No limit ranges found"
          : "Unknown",
    total: items.length,
    namespacesWithLimits,
    updatedAt: Date.now(),
  };

  const report: LimitRangesReport = {
    status,
    summary,
    items,
    updatedAt: Date.now(),
  };

  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
