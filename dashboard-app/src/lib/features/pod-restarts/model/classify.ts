export type RestartSeverity = "stable" | "flapping" | "crash_loop";

export interface ClassifyInput {
  restartCount: number;
  lastStartedAt?: string | null;
  reason?: string;
  status?: string;
}

export function classifyRestartSeverity(input: ClassifyInput): RestartSeverity {
  const reason = (input.reason ?? "").toLowerCase();
  const status = (input.status ?? "").toLowerCase();
  const now = Date.now();
  const started = input.lastStartedAt ? Date.parse(input.lastStartedAt) : 0;
  const ageMin = started > 0 ? (now - started) / 60_000 : Infinity;

  // Explicit crash-loop signals
  if (reason === "crashloopbackoff" || status.includes("crashloopbackoff")) {
    return "crash_loop";
  }
  if (reason === "evicted") return "crash_loop";

  // High restart count + recent = crash_loop
  if (input.restartCount >= 10 && ageMin < 30) return "crash_loop";
  // Medium restart count + very recent = crash_loop
  if (input.restartCount >= 5 && ageMin < 10) return "crash_loop";

  // Flapping: multiple restarts, recentish
  if (input.restartCount >= 4 && ageMin < 60) return "flapping";
  if (input.restartCount >= 10) return "flapping";

  return "stable";
}

export const SEVERITY_BADGE_CLASS: Record<RestartSeverity, string> = {
  stable: "bg-slate-500",
  flapping: "bg-amber-500",
  crash_loop: "bg-rose-600",
};

export const SEVERITY_LABEL: Record<RestartSeverity, string> = {
  stable: "stable",
  flapping: "flapping",
  crash_loop: "crash-loop",
};

export const SEVERITY_ORDER: Record<RestartSeverity, number> = {
  stable: 0,
  flapping: 1,
  crash_loop: 2,
};
