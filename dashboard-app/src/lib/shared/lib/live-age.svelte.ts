import { createSubscriber } from "svelte/reactivity";
import { formatAgeMs } from "./timeFormatters";

// One clock for every Age cell on screen. Lists fed by a watch rebuild a row only when
// the object changes, so an Age label computed with the row froze at "3s". A cell that
// reads liveAge() reruns on its own once a second; nothing else in the row is touched,
// and the text node changes only when the label does (every second under a minute,
// every minute under an hour, and so on). The timer runs only while some effect reads it.
const TICK_MS = 1000;

let nowMs = Date.now();

const subscribe = createSubscriber((update) => {
  nowMs = Date.now();
  const timer = setInterval(() => {
    nowMs = Date.now();
    update();
  }, TICK_MS);
  return () => {
    clearInterval(timer);
  };
});

/** Current time in ms. Inside an effect or template it reruns the reader every second. */
export function liveNowMs(): number {
  if (!$effect.tracking()) return Date.now();
  subscribe();
  return nowMs;
}

type Timestamp = string | number | Date | null | undefined;

function toMs(value: Timestamp): number | null {
  if (value === null || value === undefined || value === "") return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Age label ("12s", "3m", "5h", "2d") that keeps counting while it is on screen. */
export function liveAge(since: Timestamp, fallback = "-"): string {
  const sinceMs = toMs(since);
  if (sinceMs === null) return fallback;
  return formatAgeMs(liveNowMs() - sinceMs);
}

/** A creation or start time as an ISO string for a row, or null when absent or invalid. */
export function toTimestampString(value: Timestamp): string | null {
  const ms = toMs(value);
  return ms === null ? null : new Date(ms).toISOString();
}

/** Sort key for an Age column: ascending puts the youngest first, missing times last. */
export function ageSortKey(since: Timestamp): number {
  const ms = toMs(since);
  return ms === null ? Number.POSITIVE_INFINITY : -ms;
}
