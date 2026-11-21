/** Upper bound of the text a log tab keeps; older text is dropped from the head. */
export const LOG_TEXT_MAX_CHARS = 1_000_000;

// A reconnect asks for the time the stream was down plus this margin, so no line
// falls into the gap; the overlap is removed by the merger below.
const RESUME_MARGIN_SECONDS = 2;
// Lines arriving this long after the first chunk of a resumed stream are live.
const RESUME_DEDUPE_WINDOW_MS = 3_000;
const RESUME_RECENT_LINES = 2_000;

export function trimLogText(text: string, maxChars = LOG_TEXT_MAX_CHARS) {
  return text.length <= maxChars ? text : text.slice(text.length - maxChars);
}

/**
 * `--since` for a reconnect: a relative duration, so the node computes it on
 * its own clock and host/node clock skew does not matter.
 */
export function resumeSinceArg(lastChunkAt: number | null, now = Date.now()): string | null {
  if (!lastChunkAt) return null;
  const seconds = Math.max(1, Math.ceil((now - lastChunkAt) / 1000) + RESUME_MARGIN_SECONDS);
  return `--since=${seconds}s`;
}

export type StreamChunkMerger = (current: string, chunk: string) => string;

/**
 * Merges the chunks of one `kubectl logs -f` run into the tab text.
 *
 * - A fresh stream (open, mode or container switch) starts with the same
 *   `--tail` the first load showed, so its first chunk replaces the text.
 * - A resumed stream (reconnect) starts with `--since`: its lines are appended,
 *   and lines that are already among the last lines shown are dropped while the
 *   overlap arrives. The text above stays, so the reader's place stays too.
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
  let resumeStartedAt: number | null = null;
  let recent: Set<string> | null = null;

  return (current, chunk) => {
    if (!options.resume) {
      const next = first ? chunk : `${current}${chunk}`;
      first = false;
      return trimLogText(next, maxChars);
    }
    if (resumeStartedAt === null) {
      resumeStartedAt = now();
      recent = new Set(current.split("\n").slice(-RESUME_RECENT_LINES).filter(Boolean));
    }
    if (!recent || now() - resumeStartedAt > RESUME_DEDUPE_WINDOW_MS) {
      return trimLogText(`${current}${chunk}`, maxChars);
    }
    const endsWithNewline = chunk.endsWith("\n");
    const lines = chunk.split("\n");
    if (endsWithNewline) lines.pop();
    const kept = lines.filter((line) => !line || !recent?.has(line));
    if (kept.length === 0) return current;
    const separator = current && !current.endsWith("\n") ? "\n" : "";
    const appended = `${kept.join("\n")}${endsWithNewline ? "\n" : ""}`;
    return trimLogText(`${current}${separator}${appended}`, maxChars);
  };
}
