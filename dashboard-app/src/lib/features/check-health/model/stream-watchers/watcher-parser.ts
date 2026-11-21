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

function emitParsed(clusterId: string, parsed: WatchEvent) {
  if (parsed.shouldEmit === false) return;
  eventBus.emit({
    clusterId,
    kind: parsed.kind,
    payload: parsed.event,
  });
}

/**
 * Parses one watch line with the parser of the stream it came from. A watch
 * stream knows its resource type, so the event goes only to that resource's
 * consumers. Content-based guessing cannot do this: every list watch event has
 * the same shape (type + object.metadata.name).
 */
export function dispatchClusterEvent(
  clusterId: string,
  rawLine: string,
  parser: EventParser,
): WatchEvent | null {
  const parsed = parser(rawLine);
  if (!parsed) return null;
  emitParsed(clusterId, parsed);
  return parsed;
}

export function checkClusterEvent(clusterId: string, rawLine: string): WatchEvent | null {
  for (const parse of parsers) {
    const parsed = parse(rawLine);
    if (!parsed) continue;
    emitParsed(clusterId, parsed);
    return parsed;
  }

  return null;
}
