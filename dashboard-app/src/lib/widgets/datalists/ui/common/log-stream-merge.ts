/** Upper bound of the text a log tab keeps; older text is dropped from the head. */
export const LOG_TEXT_MAX_CHARS = 1_000_000;

// A reconnect asks for the time the stream was down plus this margin, so no line
// falls into the gap; the overlap is cut by timestamp in the merger below.
const RESUME_MARGIN_SECONDS = 2;
// Longer outages start a fresh stream: --since would ask for an unbounded window.
const RESUME_MAX_GAP_MS = 5 * 60_000;
// Lines arriving this long after the first chunk of a resumed stream are live;
// only lines before that can be overlap.
const RESUME_OVERLAP_WINDOW_MS = 3_000;
const RESUME_SCAN_LINES = 2_000;

// kubectl logs --timestamps puts an RFC3339Nano time first, after the
// [pod/name/container] prefix when --prefix is on.
const LOG_LINE_TIME =
  /^(?:\[[^\]]*\]\s+)?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})\s/;

type LogInstant = { seconds: number; nanos: number };

export function parseLogLineTime(line: string): LogInstant | null {
  const match = LOG_LINE_TIME.exec(line);
  if (!match) return null;
  const ms = Date.parse(`${match[1]}${match[3]}`);
  if (Number.isNaN(ms)) return null;
  return {
    seconds: ms / 1000,
    nanos: Number(((match[2] as string | undefined) ?? "").padEnd(9, "0")),
  };
}

function compareInstants(a: LogInstant, b: LogInstant) {
  return a.seconds !== b.seconds ? a.seconds - b.seconds : a.nanos - b.nanos;
}

type ShownTail = { latest: LogInstant; atLatest: Map<string, number> };

/** Latest timestamp among the last shown lines, and the lines that carry it. */
function readShownTail(text: string): ShownTail | null {
  let latest: LogInstant | null = null;
  let atLatest = new Map<string, number>();
  for (const line of text.split("\n").slice(-RESUME_SCAN_LINES)) {
    const time = parseLogLineTime(line);
    if (!time) continue;
    const order = latest ? compareInstants(time, latest) : 1;
    if (order > 0) {
      latest = time;
      atLatest = new Map([[line, 1]]);
    } else if (order === 0) {
      atLatest.set(line, (atLatest.get(line) ?? 0) + 1);
    }
  }
  return latest ? { latest, atLatest } : null;
}

export function trimLogText(text: string, maxChars = LOG_TEXT_MAX_CHARS) {
  return text.length <= maxChars ? text : text.slice(text.length - maxChars);
}

/**
 * `--since` for a reconnect, or null when the stream has to start fresh: no
 * text, no timestamps to cut the overlap by, or an outage longer than 5 min.
 * The value is a relative duration, so the node computes it on its own clock
 * and host/node clock skew does not matter.
 */
export function resumeSinceArg(
  shownText: string,
  lastChunkAt: number | null,
  now = Date.now(),
): string | null {
  if (!shownText || !lastChunkAt) return null;
  if (now - lastChunkAt > RESUME_MAX_GAP_MS) return null;
  if (!readShownTail(shownText)) return null;
  const seconds = Math.max(1, Math.ceil((now - lastChunkAt) / 1000) + RESUME_MARGIN_SECONDS);
  return `--since=${seconds}s`;
}

/**
 * Adds --since to a stream's arguments and drops --tail, which would otherwise
 * keep only the last N lines of the outage.
 */
export function applyResumeArgs(args: string[], sinceArg: string | null) {
  if (!sinceArg) return;
  for (let index = args.length - 1; index >= 0; index -= 1) {
    if (args[index]?.startsWith("--tail")) args.splice(index, 1);
  }
  args.push(sinceArg);
}

export type StreamChunkMerger = (current: string, chunk: string) => string;

/**
 * Merges the chunks of one `kubectl logs -f` run into the tab text.
 *
 * - A fresh stream (open, mode or container switch) starts with the same
 *   `--tail` the first load showed, so its first chunk replaces the text.
 * - A resumed stream (reconnect, `--since`) is appended. Its overlap with the
 *   text shown is cut by timestamp: lines older than the latest shown line are
 *   dropped, lines at that exact instant only as many times as they are shown,
 *   newer lines are kept even when their text repeats (a repeated error during
 *   an outage is still a new line). Text without timestamps cannot be resumed
 *   and is replaced like a fresh stream.
 *
 * The result is always trimmed to `maxChars`.
 */
export function createStreamChunkMerger(options: {
  resume: boolean;
  maxChars?: number;
  now?: () => number;
}): StreamChunkMerger {
  const maxChars = options.maxChars ?? LOG_TEXT_MAX_CHARS;
  const now = options.now ?? Date.now;
  let first = true;
  let replace = !options.resume;
  let overlapUntil = 0;
  let tail: ShownTail | null = null;

  return (current, chunk) => {
    if (first) {
      first = false;
      if (!replace) {
        tail = readShownTail(current);
        replace = tail === null;
        overlapUntil = now() + RESUME_OVERLAP_WINDOW_MS;
      }
      if (replace) return trimLogText(chunk, maxChars);
    } else if (replace || !tail || now() > overlapUntil) {
      return trimLogText(`${current}${chunk}`, maxChars);
    }
    const shown = tail;
    if (!shown) return trimLogText(`${current}${chunk}`, maxChars);

    const endsWithNewline = chunk.endsWith("\n");
    const lines = chunk.split("\n");
    if (endsWithNewline) lines.pop();
    const kept = lines.filter((line) => {
      const time = parseLogLineTime(line);
      if (!time) return true;
      const order = compareInstants(time, shown.latest);
      if (order > 0) return true;
      if (order < 0) return false;
      const remaining = shown.atLatest.get(line) ?? 0;
      if (remaining === 0) return true;
      shown.atLatest.set(line, remaining - 1);
      return false;
    });
    if (kept.length === 0) return current;
    const separator = current && !current.endsWith("\n") ? "\n" : "";
    const appended = `${kept.join("\n")}${endsWithNewline ? "\n" : ""}`;
    return trimLogText(`${current}${separator}${appended}`, maxChars);
  };
}
