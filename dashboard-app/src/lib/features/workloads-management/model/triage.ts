import type { WorkloadType } from "$shared/model/workloads";

export type ProblemResource = {
  id: string;
  name: string;
  namespace?: string;
  workload: WorkloadType;
  workloadKey: WorkloadType;
  workloadLabel: string;
  problemScore: number;
  status?: string;
  reason?: string;
};

export type ProblemFetchStatus = "unsupported" | "forbidden" | "unreachable" | "unknown";

export function classifyProblemFetchError(error: unknown): ProblemFetchStatus {
  const reason = error instanceof Error ? error.message : String(error);
  const normalized = reason.toLowerCase();

  if (
    normalized.includes("doesn't have a resource type") ||
    normalized.includes("no matches for kind") ||
    normalized.includes("not found") ||
    normalized.includes("the server could not find the requested resource")
  ) {
    return "unsupported";
  }
  if (
    normalized.includes("forbidden") ||
    normalized.includes("unauthorized") ||
    normalized.includes("permission")
  ) {
    return "forbidden";
  }
  if (
    normalized.includes("no route to host") ||
    normalized.includes("connection refused") ||
    normalized.includes("unable to connect") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("unreachable")
  ) {
    return "unreachable";
  }
  return "unknown";
}

export function sortProblems(items: ProblemResource[]): ProblemResource[] {
  return [...items].sort((a, b) => b.problemScore - a.problemScore || a.name.localeCompare(b.name));
}

export function selectTopProblems(items: ProblemResource[], limit = 10): ProblemResource[] {
  return sortProblems(items).slice(0, Math.max(1, limit));
}
