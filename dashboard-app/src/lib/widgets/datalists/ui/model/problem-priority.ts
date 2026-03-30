export type ProblemSeverity = "none" | "warning" | "critical";

export type ProblemTone = {
  text: string;
  chip: string;
};

const WARNING_PERCENT = 85;
const CRITICAL_PERCENT = 95;

const POD_CPU_WARNING_M = 500;
const POD_CPU_CRITICAL_M = 1000;
const POD_MEMORY_WARNING_BYTES = 512 * 1024 * 1024;
const POD_MEMORY_CRITICAL_BYTES = 1024 * 1024 * 1024;

export function parsePercentValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)%$/);
  if (!match) return null;
  const numeric = Number(match[1]);
  return Number.isFinite(numeric) ? numeric : null;
}

export function percentSeverity(value: string | null | undefined): ProblemSeverity {
  const percent = parsePercentValue(value);
  if (percent === null) return "none";
  if (percent >= CRITICAL_PERCENT) return "critical";
  if (percent >= WARNING_PERCENT) return "warning";
  return "none";
}

export function podMetricSeverityFromUsage(args: { cpuMillicores: number; memoryBytes: number }): {
  cpu: ProblemSeverity;
  memory: ProblemSeverity;
} {
  const cpu: ProblemSeverity =
    args.cpuMillicores >= POD_CPU_CRITICAL_M
      ? "critical"
      : args.cpuMillicores >= POD_CPU_WARNING_M
        ? "warning"
        : "none";
  const memory: ProblemSeverity =
    args.memoryBytes >= POD_MEMORY_CRITICAL_BYTES
      ? "critical"
      : args.memoryBytes >= POD_MEMORY_WARNING_BYTES
        ? "warning"
        : "none";
  return { cpu, memory };
}

function podStatusScore(status: string): number {
  const normalized = status.toLowerCase();
  if (
    normalized.includes("crashloopbackoff") ||
    normalized.includes("error") ||
    normalized.includes("failed")
  ) {
    return 600;
  }
  if (normalized.includes("pending") || normalized.includes("terminating")) {
    return 220;
  }
  if (normalized.includes("completed") || normalized.includes("succeeded")) {
    return 30;
  }
  if (normalized.includes("running")) return 0;
  return 120;
}

export function buildPodProblemSignals(args: {
  status: string;
  restarts: number;
  cpuMillicores: number;
  memoryBytes: number;
}) {
  const metricSeverity = podMetricSeverityFromUsage({
    cpuMillicores: args.cpuMillicores,
    memoryBytes: args.memoryBytes,
  });
  const restartsSeverity: ProblemSeverity =
    args.restarts >= 5 ? "critical" : args.restarts >= 1 ? "warning" : "none";

  let score = podStatusScore(args.status);
  score += Math.min(300, Math.max(0, args.restarts) * 25);
  if (metricSeverity.cpu === "warning") score += 90;
  if (metricSeverity.cpu === "critical") score += 180;
  if (metricSeverity.memory === "warning") score += 90;
  if (metricSeverity.memory === "critical") score += 180;

  return {
    score,
    cpuSeverity: metricSeverity.cpu,
    memorySeverity: metricSeverity.memory,
    restartsSeverity,
  };
}

export function buildNodeProblemSignals(args: {
  conditions: string;
  cpu: string | null;
  memory: string | null;
  taints: number;
}) {
  const cpuSeverity = percentSeverity(args.cpu);
  const memorySeverity = percentSeverity(args.memory);
  const parts = args.conditions
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  let score = 0;
  for (const part of parts) {
    if (part.includes("notready")) score += 700;
    else if (part.includes("ready")) score += 0;
    else if (part.includes("pressure")) score += 340;
    else if (part.includes("unreachable")) score += 500;
    else if (part.includes("schedulingdisabled")) score += 220;
    else score += 120;
  }

  if (cpuSeverity === "warning") score += 100;
  if (cpuSeverity === "critical") score += 200;
  if (memorySeverity === "warning") score += 100;
  if (memorySeverity === "critical") score += 200;
  score += Math.min(220, Math.max(0, args.taints) * 20);

  return {
    score,
    cpuSeverity,
    memorySeverity,
  };
}

function clampNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function buildDeploymentProblemScore(args: {
  replicas: number;
  ready: number;
  upToDate: number;
  available: number;
  status: string;
}) {
  const desired = clampNonNegative(args.replicas);
  const ready = clampNonNegative(args.ready);
  const upToDate = clampNonNegative(args.upToDate);
  const available = clampNonNegative(args.available);

  const readyGap = Math.max(0, desired - ready);
  const updatedGap = Math.max(0, desired - upToDate);
  const availableGap = Math.max(0, desired - available);

  let score = readyGap * 160 + updatedGap * 120 + availableGap * 140;
  const normalizedStatus = args.status.toLowerCase();
  if (normalizedStatus.includes("failed")) score += 500;
  else if (normalizedStatus.includes("pending")) score += 180;
  else if (normalizedStatus.includes("running")) score += 0;
  else score += 80;
  return score;
}

export function buildDaemonSetProblemScore(args: {
  desired: number;
  ready: number;
  updated: number;
  available: number;
}) {
  const desired = clampNonNegative(args.desired);
  const ready = clampNonNegative(args.ready);
  const updated = clampNonNegative(args.updated);
  const available = clampNonNegative(args.available);

  const readyGap = Math.max(0, desired - ready);
  const updatedGap = Math.max(0, desired - updated);
  const availableGap = Math.max(0, desired - available);
  return readyGap * 160 + updatedGap * 120 + availableGap * 140;
}

export function buildStatefulSetProblemScore(args: { replicas: number; ready: number }) {
  const replicas = clampNonNegative(args.replicas);
  const ready = clampNonNegative(args.ready);
  return Math.max(0, replicas - ready) * 170;
}

export function buildReplicaSetProblemScore(args: {
  desired: number;
  current: number;
  ready: number;
}) {
  const desired = clampNonNegative(args.desired);
  const current = clampNonNegative(args.current);
  const ready = clampNonNegative(args.ready);
  const currentGap = Math.max(0, desired - current);
  const readyGap = Math.max(0, desired - ready);
  return readyGap * 170 + currentGap * 110;
}

export function buildJobProblemScore(args: {
  status: string;
  succeeded: number;
  completions: number;
}) {
  const status = args.status.toLowerCase();
  const completions = clampNonNegative(args.completions);
  const succeeded = clampNonNegative(args.succeeded);
  const completionGap = Math.max(0, completions - succeeded);

  let score = completionGap * 120;
  if (status.includes("failed")) score += 550;
  else if (status.includes("running")) score += 220;
  else if (status.includes("complete") || status.includes("succeeded")) score += 0;
  else if (status.includes("pending")) score += 160;
  else score += 80;
  return score;
}

export function buildCronJobProblemScore(args: {
  suspend: boolean;
  active: number;
  hasLastSchedule: boolean;
}) {
  const active = clampNonNegative(args.active);
  let score = 0;
  if (!args.suspend && !args.hasLastSchedule) score += 200;
  if (args.suspend) score += 80;
  if (active > 0) score += Math.min(200, active * 40);
  return score;
}

export function getProblemTone(severity: ProblemSeverity): ProblemTone {
  if (severity === "critical") {
    return {
      text: "text-rose-700 dark:text-rose-300",
      chip: "border-rose-300/60 bg-rose-100/40 text-rose-700 dark:text-rose-300",
    };
  }
  if (severity === "warning") {
    return {
      text: "text-amber-700 dark:text-amber-300",
      chip: "border-amber-300/60 bg-amber-100/40 text-amber-700 dark:text-amber-300",
    };
  }
  return {
    text: "",
    chip: "border-slate-300/60 bg-muted/30 text-muted-foreground",
  };
}
