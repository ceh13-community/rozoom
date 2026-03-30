const DEFAULT_MAX_COOLDOWN_MS = 90_000;

type PodsRefreshGuardState = {
  errorStreak: number;
  cooldownUntil: number;
};

export function createPodsRefreshGuard() {
  const state: PodsRefreshGuardState = {
    errorStreak: 0,
    cooldownUntil: 0,
  };

  const applyError = (message: string, now = Date.now()) => {
    state.errorStreak += 1;
    const normalized = message.toLowerCase();
    let baseMs = 3_000;
    if (
      normalized.includes("context deadline exceeded") ||
      normalized.includes("i/o timeout") ||
      normalized.includes("unable to connect") ||
      normalized.includes("serviceunavailable")
    ) {
      baseMs = 8_000;
    } else if (
      normalized.includes("metrics api not available") ||
      normalized.includes("no endpoints available for service")
    ) {
      baseMs = 20_000;
    }
    const backoffMs = Math.min(
      DEFAULT_MAX_COOLDOWN_MS,
      baseMs * 2 ** Math.max(0, state.errorStreak - 1),
    );
    state.cooldownUntil = now + backoffMs;
    return {
      errorStreak: state.errorStreak,
      cooldownUntil: state.cooldownUntil,
      backoffMs,
    };
  };

  const reset = () => {
    state.errorStreak = 0;
    state.cooldownUntil = 0;
  };

  const isCoolingDown = (now = Date.now()) => state.cooldownUntil > now;

  const getRemainingCooldownMs = (now = Date.now()) => Math.max(0, state.cooldownUntil - now);

  return {
    applyError,
    reset,
    isCoolingDown,
    getRemainingCooldownMs,
  };
}
