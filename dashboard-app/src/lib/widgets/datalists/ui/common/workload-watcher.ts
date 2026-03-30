import { createWatcherEngine } from "$shared/lib/watcher-engine";
import { trackWorkloadEvent } from "$features/workloads-management";

type WorkloadWatcherOptions = {
  isEnabled: () => boolean;
  getRefreshSeconds: () => number;
  onTick: () => Promise<void>;
  workloadName?: string | (() => string);
};

export function createWorkloadWatcher(options: WorkloadWatcherOptions) {
  const resolveWorkloadName = () =>
    typeof options.workloadName === "function"
      ? options.workloadName()
      : (options.workloadName ?? "unknown");
  return createWatcherEngine({
    isEnabled: options.isEnabled,
    getRefreshSeconds: options.getRefreshSeconds,
    isVisible: () =>
      typeof document === "undefined" ? true : document.visibilityState === "visible",
    onTick: options.onTick,
    onSchedule: ({ refreshSeconds, errorStreak }) => {
      if (errorStreak === 0) return;
      trackWorkloadEvent("workloads.watcher_backoff_ms", {
        workload: resolveWorkloadName(),
        durationMs: refreshSeconds * 1000,
        backoffMs: refreshSeconds * 1000,
        errorStreak,
      });
    },
    onTickError: ({ trigger, errorStreak }) => {
      trackWorkloadEvent("workloads.watcher_retry", {
        workload: resolveWorkloadName(),
        trigger,
        retryCount: errorStreak,
        errorStreak,
      });
    },
    onTickSuccess: ({ trigger }) => {
      trackWorkloadEvent("workloads.watcher_recovered", {
        workload: resolveWorkloadName(),
        trigger,
      });
    },
  });
}
