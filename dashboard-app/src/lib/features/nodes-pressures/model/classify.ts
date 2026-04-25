export type NodeSeverity = "healthy" | "warning" | "critical" | "cordoned";

export interface ClassifyInput {
  ready: string;
  diskPressure: string;
  memoryPressure: string;
  pidPressure: string;
  networkUnavailable: string;
  unschedulable?: boolean;
}

export function classifyNodeSeverity(input: ClassifyInput): NodeSeverity {
  const notReady = input.ready !== "True";
  const netDown = input.networkUnavailable === "True";
  const dp = input.diskPressure === "True";
  const mp = input.memoryPressure === "True";
  const pp = input.pidPressure === "True";
  const pressureCount = [dp, mp, pp].filter(Boolean).length;

  if (notReady || netDown) return "critical";
  if (pressureCount >= 2) return "critical";
  if (pressureCount === 1) return "warning";
  if (input.unschedulable) return "cordoned";
  return "healthy";
}

export const SEVERITY_BADGE_CLASS: Record<NodeSeverity, string> = {
  healthy: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-rose-600",
  cordoned: "bg-slate-500",
};

export const SEVERITY_LABEL: Record<NodeSeverity, string> = {
  healthy: "healthy",
  warning: "warning",
  critical: "critical",
  cordoned: "cordoned",
};

export const SEVERITY_RANK: Record<NodeSeverity, number> = {
  healthy: 0,
  cordoned: 1,
  warning: 2,
  critical: 3,
};
