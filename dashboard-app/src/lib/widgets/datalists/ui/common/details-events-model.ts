// The Events block of a details panel: one row per distinct event, repeats folded into
// that row with a count, Warning events above Normal ones, newest first within each.

export type DetailsEvent = {
  type?: string;
  reason?: string;
  message?: string;
  lastTimestamp?: string;
  source?: string;
  count?: string | number;
  /** The object the event is about, when a panel lists events of several objects. */
  object?: string;
};

export type DetailsEventRow = {
  type: string;
  reason: string;
  message: string;
  lastTimestamp: string;
  source?: string;
  object?: string;
  /** How many times it happened: Kubernetes' own count, added up over repeated entries. */
  count: number;
};

function toTime(value?: string) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toCount(value?: string | number) {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function isWarning(type: string) {
  return type.toLowerCase() === "warning";
}

export function groupDetailsEvents(events: readonly DetailsEvent[]): DetailsEventRow[] {
  const rows = new Map<string, DetailsEventRow>();
  for (const event of events) {
    const type = event.type?.trim() || "Normal";
    const reason = event.reason?.trim() || "-";
    const message = event.message?.trim() || "-";
    const key = [type, reason, message, event.object ?? ""].join("\u0000");
    const count = toCount(event.count);
    const existing = rows.get(key);
    if (!existing) {
      rows.set(key, {
        type,
        reason,
        message,
        lastTimestamp: event.lastTimestamp?.trim() || "-",
        source: event.source || undefined,
        object: event.object,
        count,
      });
      continue;
    }
    existing.count += count;
    if (toTime(event.lastTimestamp) > toTime(existing.lastTimestamp)) {
      existing.lastTimestamp = event.lastTimestamp?.trim() || existing.lastTimestamp;
      existing.source = event.source || existing.source;
    }
  }
  return [...rows.values()].sort((a, b) => {
    const warningFirst = Number(isWarning(b.type)) - Number(isWarning(a.type));
    return warningFirst || toTime(b.lastTimestamp) - toTime(a.lastTimestamp);
  });
}
