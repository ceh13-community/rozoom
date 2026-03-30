type AbortKey = string;

export function createAbortManager() {
  const controllers = new Map<AbortKey, AbortController>();

  function nextSignal(key: AbortKey): AbortSignal {
    const existing = controllers.get(key);
    if (existing) existing.abort();
    const controller = new AbortController();
    controllers.set(key, controller);
    return controller.signal;
  }

  function abort(key: AbortKey) {
    const controller = controllers.get(key);
    if (!controller) return;
    controller.abort();
    controllers.delete(key);
  }

  function abortAll() {
    for (const controller of controllers.values()) {
      controller.abort();
    }
    controllers.clear();
  }

  function isLatest(key: AbortKey, signal: AbortSignal): boolean {
    const controller = controllers.get(key);
    return Boolean(controller && controller.signal === signal && !signal.aborted);
  }

  return {
    nextSignal,
    abort,
    abortAll,
    isLatest,
  };
}
