export type StatusState = "ready" | "progressing" | "error" | "unknown";

export function podPhaseToState(phase: string | undefined): StatusState {
  const normalized = (phase ?? "").toLowerCase();
  if (normalized === "running" || normalized === "succeeded") return "ready";
  if (normalized === "pending") return "progressing";
  if (normalized === "failed") return "error";
  return "unknown";
}

export function containerLabelToState(label: string): StatusState {
  const normalized = label.toLowerCase();
  if (normalized.includes("terminated") || normalized.includes("failed")) return "error";
  if (normalized.includes("waiting") || normalized.includes("pending")) return "progressing";
  if (normalized.includes("running") || normalized.includes("ready")) return "ready";
  return "unknown";
}
