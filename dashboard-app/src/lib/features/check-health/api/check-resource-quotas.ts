import { error as logError } from "@tauri-apps/plugin-log";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import type {
  ResourceQuotasItem,
  ResourceQuotasReport,
  ResourceQuotasStatus,
} from "../model/types";

const CACHE_MS = 60 * 1000;
const cachedReports = new Map<string, { data: ResourceQuotasReport; fetchedAt: number }>();

function parseLines(raw: string): ResourceQuotasItem[] {
  const items: ResourceQuotasItem[] = [];
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;

    const namespace = parts[0];
    const name = parts[1];
    const hardCpu = parts[2] && parts[2] !== "<none>" ? parts[2] : undefined;
    const usedCpu = parts[3] && parts[3] !== "<none>" ? parts[3] : undefined;
    const hardMemory = parts[4] && parts[4] !== "<none>" ? parts[4] : undefined;
    const usedMemory = parts[5] && parts[5] !== "<none>" ? parts[5] : undefined;

    items.push({ namespace, name, hardCpu, usedCpu, hardMemory, usedMemory });
  }

  return items;
}

function computeStatus(items: ResourceQuotasItem[]): ResourceQuotasStatus {
  if (items.length === 0) return "warning";
  return "ok";
}

export async function checkResourceQuotas(
  clusterId: string,
  options?: { force?: boolean },
): Promise<ResourceQuotasReport> {
  const cached = cachedReports.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.data;
  }

  let errorMessage: string | undefined;
  let items: ResourceQuotasItem[] = [];

  try {
    const result = await kubectlRawFront(
      "get resourcequotas --all-namespaces --no-headers -o custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name,HARD_CPU:.status.hard.cpu,USED_CPU:.status.used.cpu,HARD_MEM:.status.hard.memory,USED_MEM:.status.used.memory",
      { clusterId },
    );
    if (result.errors || result.code !== 0) {
      const isNoResources = result.errors.includes("No resources found");
      if (!isNoResources) {
        errorMessage = result.errors || "Failed to fetch resource quotas.";
        await logError(`Resource quotas check failed: ${errorMessage}`);
      }
    } else {
      items = parseLines(result.output);
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to fetch resource quotas.";
    await logError(`Resource quotas check failed: ${errorMessage}`);
  }

  const namespacesWithQuotas = new Set(items.map((item) => item.namespace)).size;
  const status: ResourceQuotasStatus = errorMessage ? "unknown" : computeStatus(items);

  const summary = {
    status,
    message:
      status === "ok"
        ? `${items.length} quota${items.length !== 1 ? "s" : ""} across ${namespacesWithQuotas} namespace${namespacesWithQuotas !== 1 ? "s" : ""}`
        : status === "warning"
          ? "No resource quotas found"
          : "Unknown",
    total: items.length,
    namespacesWithQuotas,
    namespacesWithoutQuotas: 0,
    updatedAt: Date.now(),
  };

  const report: ResourceQuotasReport = {
    status,
    summary,
    items,
    updatedAt: Date.now(),
  };

  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
