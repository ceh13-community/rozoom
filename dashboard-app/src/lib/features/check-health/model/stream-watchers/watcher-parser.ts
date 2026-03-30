import { eventBus } from "./event-bus";

export type WatchEvent = {
  kind: string;
  event: unknown;
  resourceVersion?: string;
  shouldEmit?: boolean;
};

export type EventParser = (rawLine: string) => WatchEvent | null;

const parsers: EventParser[] = [];

export function registerParser(parser: EventParser) {
  parsers.push(parser);
}

export function resetWatchParsersForTests() {
  parsers.length = 0;
}

export function checkClusterEvent(clusterId: string, rawLine: string): WatchEvent | null {
  for (const parse of parsers) {
    const parsed = parse(rawLine);
    if (!parsed) continue;

    if (parsed.shouldEmit !== false) {
      eventBus.emit({
        clusterId,
        kind: parsed.kind,
        payload: parsed.event,
      });
    }

    return parsed;
  }

  return null;
}
