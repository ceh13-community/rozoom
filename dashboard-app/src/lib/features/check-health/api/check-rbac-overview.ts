import { error as logError } from "@tauri-apps/plugin-log";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import type { RbacOverviewReport, RbacOverviewStatus } from "../model/types";

const CACHE_MS = 60 * 1000;
const cachedReports = new Map<string, { data: RbacOverviewReport; fetchedAt: number }>();

type RawBinding = {
  name: string;
  role: string;
  subjects: string;
};

function parseLines(raw: string): RawBinding[] {
  const items: RawBinding[] = [];
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;

    const name = parts[0];
    const role = parts[1];
    const subjects = parts.slice(2).join(" ");
    items.push({ name, role, subjects });
  }

  return items;
}

function countOverprivileged(bindings: RawBinding[]): {
  clusterAdminBindings: number;
  overprivilegedCount: number;
} {
  let clusterAdminBindings = 0;
  let overprivilegedCount = 0;

  for (const binding of bindings) {
    if (binding.role !== "cluster-admin") continue;
    clusterAdminBindings++;

    const subjectNames = binding.subjects
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const nonSystemSubjects = subjectNames.filter(
      (s) => !s.startsWith("system:") && s !== "<none>",
    );
    if (nonSystemSubjects.length > 0) {
      overprivilegedCount += nonSystemSubjects.length;
    }
  }

  return { clusterAdminBindings, overprivilegedCount };
}

export async function checkRbacOverview(
  clusterId: string,
  options?: { force?: boolean },
): Promise<RbacOverviewReport> {
  const cached = cachedReports.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.data;
  }

  let errorMessage: string | undefined;
  let bindings: RawBinding[] = [];

  try {
    const result = await kubectlRawFront(
      "get clusterrolebindings --no-headers -o custom-columns=NAME:.metadata.name,ROLE:.roleRef.name,SUBJECTS:.subjects[*].name",
      { clusterId },
    );
    if (result.errors || result.code !== 0) {
      const isNoResources = result.errors.includes("No resources found");
      if (!isNoResources) {
        errorMessage = result.errors || "Failed to fetch RBAC bindings.";
        await logError(`RBAC overview check failed: ${errorMessage}`);
      }
    } else {
      bindings = parseLines(result.output);
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to fetch RBAC bindings.";
    await logError(`RBAC overview check failed: ${errorMessage}`);
  }

  const { clusterAdminBindings, overprivilegedCount } = countOverprivileged(bindings);
  let status: RbacOverviewStatus = "ok";
  if (errorMessage) {
    status = "unknown";
  } else if (overprivilegedCount > 0) {
    status = "warning";
  }

  let message = "OK";
  if (status === "unknown") {
    message = "Unknown";
  } else if (status === "warning") {
    message = `${overprivilegedCount} non-system cluster-admin binding${overprivilegedCount !== 1 ? "s" : ""}`;
  }

  const summary = {
    status,
    message,
    totalBindings: bindings.length,
    clusterAdminBindings,
    overprivilegedCount,
    updatedAt: Date.now(),
  };

  const report: RbacOverviewReport = {
    status,
    summary,
    updatedAt: Date.now(),
  };

  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
