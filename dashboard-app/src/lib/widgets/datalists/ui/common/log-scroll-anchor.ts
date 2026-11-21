const ANCHOR_WINDOW = 3;

function windowMatches(lines: string[], start: number, anchor: string[]) {
  if (start < 0 || start + anchor.length > lines.length) return false;
  for (let offset = 0; offset < anchor.length; offset += 1) {
    if (lines[start + offset] !== anchor[offset]) return false;
  }
  return true;
}

/**
 * Finds where the line at the top of the reader's view moved after the log text
 * changed. A poll replaces the text with the latest tail, and a capped stream
 * drops lines from the head, so the same content sits at a lower index. The top
 * line plus the next ones form the anchor, because single lines (blank lines,
 * repeated messages) are not unique.
 *
 * Returns the new index of the anchored line, 0 when it scrolled out of the
 * retained text, or null when there is nothing to anchor.
 */
export function findAnchoredLineIndex(
  previous: readonly string[],
  next: readonly string[],
  topIndex: number,
): number | null {
  if (topIndex < 0 || topIndex >= previous.length || next.length === 0) return null;
  const anchor = previous.slice(topIndex, topIndex + ANCHOR_WINDOW);
  const nextLines = next as string[];

  if (windowMatches(nextLines, topIndex, anchor)) return topIndex;

  // Content only moves up when the head is trimmed, so search from the old
  // position towards the start and take the nearest match.
  for (let index = Math.min(topIndex, next.length - 1); index >= 0; index -= 1) {
    if (windowMatches(nextLines, index, anchor)) return index;
  }
  for (let index = topIndex + 1; index < next.length; index += 1) {
    if (windowMatches(nextLines, index, anchor)) return index;
  }
  return 0;
}
