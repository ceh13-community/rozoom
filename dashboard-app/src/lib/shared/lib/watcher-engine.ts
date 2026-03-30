import { computeAdaptivePollingSeconds } from "./adaptive-polling";

type WatcherTrigger = "start" | "timer" | "manual";

type WatcherEngineOptions = {
  isEnabled: () => boolean;
  getRefreshSeconds: () => number;
  isVisible?: () => boolean;
  onTick: (trigger: WatcherTrigger) => Promise<void>;
  onSchedule?: (state: { refreshSeconds: number; errorStreak: number }) => void;
  onTickSuccess?: (state: { trigger: WatcherTrigger; errorStreak: number }) => void;
  onTickError?: (state: { trigger: WatcherTrigger; errorStreak: number }) => void;
};

export function createWatcherEngine(options: WatcherEngineOptions) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let errorStreak = 0;
  let burstUntil = 0;

  const clearTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const schedule = () => {
    clearTimer();
    if (!options.isEnabled()) return;
    if (options.isVisible && !options.isVisible()) return;
    const refreshSeconds = computeAdaptivePollingSeconds(options.getRefreshSeconds(), {
      isVisible: options.isVisible ? options.isVisible() : true,
      errorStreak,
      burstUntil,
    });
    options.onSchedule?.({ refreshSeconds, errorStreak });
    timer = setTimeout(() => {
      timer = null;
      void tick("timer");
    }, refreshSeconds * 1000);
  };

  const tick = async (trigger: WatcherTrigger) => {
    if (!options.isEnabled()) return;
    if (options.isVisible && !options.isVisible()) return;
    if (inFlight) return;
    inFlight = true;
    try {
      await options.onTick(trigger);
      errorStreak = 0;
      options.onTickSuccess?.({ trigger, errorStreak });
      if (trigger === "manual") {
        burstUntil = Date.now() + 20_000;
      }
    } catch {
      errorStreak += 1;
      options.onTickError?.({ trigger, errorStreak });
      if (trigger === "manual") {
        burstUntil = Date.now() + 12_000;
      }
    } finally {
      inFlight = false;
      schedule();
    }
  };

  return {
    start: (immediate = false) => {
      if (immediate) {
        void tick("start");
      } else {
        schedule();
      }
    },
    stop: () => {
      clearTimer();
    },
    trigger: (options?: { mutation?: boolean }) => {
      if (options?.mutation) {
        burstUntil = Date.now() + 25_000;
      }
      void tick("manual");
    },
    reschedule: () => {
      schedule();
    },
    isInFlight: () => inFlight,
  };
}
