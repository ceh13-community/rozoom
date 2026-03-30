export type TelemetryEvent = {
  source: string;
  name: string;
  at: number;
  payload?: Record<string, unknown>;
};

type TelemetryListener = (event: TelemetryEvent) => void;

export function createTelemetryEventBus(maxEvents = 500, maxAgeMs = 60 * 60 * 1000) {
  const listeners = new Set<TelemetryListener>();
  const events: TelemetryEvent[] = [];

  function cleanup(referenceAt?: number) {
    const anchor =
      typeof referenceAt === "number" && Number.isFinite(referenceAt)
        ? referenceAt
        : events.length > 0
          ? (events[events.length - 1]?.at ?? Date.now())
          : Date.now();
    const minAt = anchor - Math.max(1, maxAgeMs);
    const fresh = events.filter((event) => event.at >= minAt);
    events.length = 0;
    events.push(...fresh);
    if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
  }

  function emit(event: TelemetryEvent) {
    cleanup(event.at);
    events.push(event);
    if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
    for (const listener of listeners) listener(event);
  }

  return {
    emit,
    subscribe(listener: TelemetryListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    list() {
      cleanup(events[events.length - 1]?.at);
      return events.slice();
    },
    clearEvents() {
      events.length = 0;
    },
    clearBySource(source: string) {
      cleanup(events[events.length - 1]?.at);
      const next = events.filter((event) => event.source !== source);
      events.length = 0;
      events.push(...next);
    },
    clearListeners() {
      listeners.clear();
    },
  };
}

export const telemetryEventBus = createTelemetryEventBus();
