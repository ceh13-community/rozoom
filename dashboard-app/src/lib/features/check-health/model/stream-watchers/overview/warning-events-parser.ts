type RawEventObject = {
  kind?: string;
  name?: string;
};

type RawWarningEvent = {
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  eventTime?: string;
  metadata?: {
    uid?: string;
    namespace?: string;
    creationTimestamp?: string;
  };
  involvedObject?: RawEventObject;
};

export type WarningEventWatchEvent = {
  type: "ADDED" | "MODIFIED" | "DELETED" | "BOOKMARK";
  object: RawWarningEvent;
};

export function parseWarningEventJsonLine(line: string) {
  try {
    const data = JSON.parse(line) as unknown;
    if (typeof data !== "object" || data === null) return null;
    const event = data as Partial<WarningEventWatchEvent>;
    if (!event.type || !event.object || typeof event.object !== "object") return null;
    return {
      kind: "warning-event",
      event: event as WarningEventWatchEvent,
      shouldEmit: event.type !== "BOOKMARK",
    } as const;
  } catch {
    return null;
  }
}
