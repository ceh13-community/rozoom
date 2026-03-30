import { error as logError } from "@tauri-apps/plugin-log";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import type { PodItem } from "$shared/model/clusters";
import type { PodIssueItem, PodIssuesReport, PodIssueStatus } from "../model/types";

const CACHE_MS = 60 * 1000;
const PENDING_THRESHOLD_MINUTES = 10;
const RESTART_THRESHOLD = 5;
const WARNING_RATIO = 0.05;
const CRITICAL_RATIO = 0.1;

const cachedIssues = new Map<string, { data: PodIssuesReport; fetchedAt: number }>();

type RawContainerStatus = {
  restartCount?: number;
  state?: { waiting?: { reason?: string; message?: string } };
  lastState?: { terminated?: { reason?: string; message?: string } };
};

type RawPodStatus = {
  phase?: string;
  reason?: string;
  message?: string;
  conditions?: Array<{ reason?: string; message?: string }>;
  containerStatuses?: RawContainerStatus[];
};

type RawPod = {
  metadata?: { name?: string; namespace?: string; creationTimestamp?: string };
  status?: RawPodStatus;
};

type RawPodList = {
  items?: RawPod[];
};

function parseJson(raw: string): RawPodList | null {
  try {
    return JSON.parse(raw) as RawPodList;
  } catch {
    return null;
  }
}

function computeAgeMinutes(timestamp?: string | Date): number | undefined {
  if (!timestamp) return undefined;
  const value = timestamp instanceof Date ? timestamp.getTime() : Date.parse(timestamp);
  if (!Number.isFinite(value)) return undefined;
  return (Date.now() - value) / (1000 * 60);
}

function getRestartCount(statuses?: Array<{ restartCount?: number }>): number {
  if (!statuses?.length) return 0;
  return statuses.reduce((total, item) => total + (item.restartCount ?? 0), 0);
}

function findCrashReason(statuses?: RawContainerStatus[]): string | undefined {
  if (!statuses?.length) return undefined;
  const waiting = statuses.find((item) => item.state?.waiting?.reason === "CrashLoopBackOff");
  if (waiting?.state?.waiting?.message) return waiting.state.waiting.message;
  const terminated = statuses.find((item) => item.lastState?.terminated?.reason);
  return terminated?.lastState?.terminated?.reason;
}

function findPendingReason(status?: RawPodStatus): string | undefined {
  if (!status) return undefined;
  const condition = status.conditions?.find((item) => item.reason || item.message);
  return status.reason || condition?.reason || condition?.message || status.message;
}

function buildReport(
  items: PodIssueItem[],
  totalPods: number,
  errorMessage?: string,
): PodIssuesReport {
  if (errorMessage) {
    return {
      status: "unknown",
      summary: {
        status: "unknown",
        warnings: [errorMessage],
        message: "Detection unavailable.",
        updatedAt: Date.now(),
      },
      items: [],
      totalPods,
      crashLoopCount: 0,
      pendingCount: 0,
      errors: errorMessage,
      updatedAt: Date.now(),
    };
  }

  const crashLoopCount = items.filter((item) => item.type === "crashloop").length;
  const pendingCount = items.filter((item) => item.type === "pending").length;
  const impacted = crashLoopCount + pendingCount;
  const ratio = totalPods > 0 ? impacted / totalPods : 0;

  let status: PodIssueStatus = "ok";
  const warnings: string[] = [];

  if (crashLoopCount > 0 || ratio >= CRITICAL_RATIO) {
    status = "critical";
    if (crashLoopCount > 0) warnings.push("CrashLoopBackOff pods detected.");
    if (ratio >= CRITICAL_RATIO) warnings.push("Pod issues exceed critical threshold.");
  } else if (pendingCount > 0 || ratio >= WARNING_RATIO) {
    status = "warning";
    if (pendingCount > 0) warnings.push("Pending pods older than threshold detected.");
    if (ratio >= WARNING_RATIO) warnings.push("Pod issues exceed warning threshold.");
  }

  const message =
    impacted > 0
      ? `CrashLoop: ${crashLoopCount} · Pending: ${pendingCount}`
      : "No CrashLoopBackOff or long Pending pods detected.";

  return {
    status,
    summary: { status, warnings, message, updatedAt: Date.now() },
    items,
    totalPods,
    crashLoopCount,
    pendingCount,
    updatedAt: Date.now(),
  };
}

function mapPods(pods: PodItem[]): PodIssuesReport {
  const items: PodIssueItem[] = [];
  const totalPods = pods.length;

  for (const pod of pods) {
    const namespace = pod.metadata.namespace;
    const name = pod.metadata.name;
    const phase = pod.status.phase;
    const ageMinutes = computeAgeMinutes(pod.metadata.creationTimestamp);
    const containerStatuses = pod.status.containerStatuses ?? [];
    const restarts = getRestartCount(containerStatuses);
    const hasCrashLoop = containerStatuses.some(
      (item) => item.state.waiting?.reason === "CrashLoopBackOff",
    );
    if (hasCrashLoop || restarts >= RESTART_THRESHOLD) {
      const reason = findCrashReason(containerStatuses) ?? "CrashLoopBackOff";
      items.push({
        namespace,
        pod: name,
        type: "crashloop",
        status: "critical",
        restarts,
        ageMinutes,
        reason,
      });
      continue;
    }

    if (
      phase === "Pending" &&
      ageMinutes !== undefined &&
      ageMinutes >= PENDING_THRESHOLD_MINUTES
    ) {
      const reason = findPendingReason(pod.status);
      items.push({
        namespace,
        pod: name,
        type: "pending",
        status: "warning",
        restarts,
        ageMinutes,
        reason,
      });
    }
  }

  return buildReport(items, totalPods);
}

function mapRawPods(pods: RawPodList["items"]): PodIssuesReport {
  const items: PodIssueItem[] = [];
  const totalPods = pods?.length ?? 0;

  for (const pod of pods ?? []) {
    const namespace = pod.metadata?.namespace ?? "default";
    const name = pod.metadata?.name ?? "unknown";
    const phase = pod.status?.phase ?? "Unknown";
    const ageMinutes = computeAgeMinutes(pod.metadata?.creationTimestamp);
    const restarts = getRestartCount(pod.status?.containerStatuses);

    const hasCrashLoop = pod.status?.containerStatuses?.some(
      (item) => item.state?.waiting?.reason === "CrashLoopBackOff",
    );
    if (hasCrashLoop || restarts >= RESTART_THRESHOLD) {
      const reason = findCrashReason(pod.status?.containerStatuses) ?? "CrashLoopBackOff";
      items.push({
        namespace,
        pod: name,
        type: "crashloop",
        status: "critical",
        restarts,
        ageMinutes,
        reason,
      });
      continue;
    }

    if (
      phase === "Pending" &&
      ageMinutes !== undefined &&
      ageMinutes >= PENDING_THRESHOLD_MINUTES
    ) {
      const reason = findPendingReason(pod.status);
      items.push({
        namespace,
        pod: name,
        type: "pending",
        status: "warning",
        restarts,
        ageMinutes,
        reason,
      });
    }
  }

  return buildReport(items, totalPods);
}

export async function checkPodIssues(
  clusterId: string,
  options?: { force?: boolean; pods?: PodItem[] },
): Promise<PodIssuesReport> {
  const cached = cachedIssues.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.data;
  }

  if (options?.pods) {
    const report = mapPods(options.pods);
    cachedIssues.set(clusterId, { data: report, fetchedAt: Date.now() });
    return report;
  }

  let errorMessage: string | undefined;
  try {
    const response = await kubectlRawFront("get pods --all-namespaces -o json", { clusterId });
    if (response.errors || response.code !== 0) {
      errorMessage = response.errors || "Failed to fetch pods for issue detection.";
      await logError(`Pod issue detection failed: ${errorMessage}`);
      const report = buildReport([], 0, errorMessage);
      cachedIssues.set(clusterId, { data: report, fetchedAt: Date.now() });
      return report;
    }
    const parsed = parseJson(response.output);
    if (!parsed?.items) {
      errorMessage = "No pod data returned.";
      const report = buildReport([], 0, errorMessage);
      cachedIssues.set(clusterId, { data: report, fetchedAt: Date.now() });
      return report;
    }
    const report = mapRawPods(parsed.items);
    cachedIssues.set(clusterId, { data: report, fetchedAt: Date.now() });
    return report;
  } catch (error) {
    errorMessage =
      error instanceof Error ? error.message : "Failed to fetch pods for issue detection.";
    await logError(`Pod issue detection failed: ${errorMessage}`);
    const report = buildReport([], 0, errorMessage);
    cachedIssues.set(clusterId, { data: report, fetchedAt: Date.now() });
    return report;
  }
}
