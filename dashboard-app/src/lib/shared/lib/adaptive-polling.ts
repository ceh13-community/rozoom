import { workloadRequestScheduler } from "./request-scheduler";

type AdaptivePollingOptions = {
  hasRecentMutation?: boolean;
  isVisible?: boolean;
  minSeconds?: number;
  maxSeconds?: number;
  errorStreak?: number;
  burstUntil?: number;
  now?: number;
};

export function computeAdaptivePollingSeconds(
  baseSeconds: number,
  options?: AdaptivePollingOptions,
): number {
  const minSeconds = Math.max(1, Math.round(options?.minSeconds ?? 5));
  const maxSeconds = Math.max(minSeconds, Math.round(options?.maxSeconds ?? 600));
  const normalizedBase = Math.max(minSeconds, Math.round(baseSeconds));

  let multiplier = 1;
  const queued = workloadRequestScheduler.getQueuedCount();
  const active = workloadRequestScheduler.getActiveCount();
  if (queued >= 6) multiplier *= 1.6;
  if (active >= 4) multiplier *= 1.2;
  const errorStreak = Math.max(0, Math.floor(options?.errorStreak ?? 0));
  if (errorStreak > 0) {
    multiplier *= Math.min(2.4, 1 + errorStreak * 0.35);
  }
  if (options?.hasRecentMutation) multiplier *= 0.8;
  const now = options?.now ?? Date.now();
  if ((options?.burstUntil ?? 0) > now) multiplier *= 0.6;
  if (options?.isVisible === false) multiplier *= 2;

  const next = Math.round(normalizedBase * multiplier);
  return Math.max(minSeconds, Math.min(maxSeconds, next));
}
