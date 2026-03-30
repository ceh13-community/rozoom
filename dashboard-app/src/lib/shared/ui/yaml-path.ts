/**
 * YAML path resolution utilities.
 *
 * Given a document and cursor position, compute the full YAML path
 * (e.g. spec > template > spec > containers[0] > image).
 */

export type PathSegment = {
  key: string;
  line: number; // 1-based
};

/**
 * Walk backwards from a given line to build the YAML path at that position.
 * Handles nested mappings, list items, and multi-document separators.
 */
export function getYamlPathAtLine(doc: string, lineIndex: number): PathSegment[] {
  const lines = doc.split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) return [];

  const segments: PathSegment[] = [];

  // Get the indent of the target line
  const targetLine = lines[lineIndex];
  const targetIndent = getIndent(targetLine);

  // Extract key from the target line itself
  const targetKey = extractKey(targetLine);
  if (targetKey) {
    segments.unshift({ key: targetKey, line: lineIndex + 1 });
  }

  // Walk backwards, collecting parent keys at decreasing indent levels
  let currentIndent = targetKey ? targetIndent : targetIndent + 1;

  // Track list item indices for array notation
  const listCounter: Map<number, number> = new Map();

  for (let i = lineIndex - (targetKey ? 1 : 0); i >= 0; i--) {
    const line = lines[i];

    // Stop at document separator
    if (/^---\s*$/.test(line) || /^\.\.\.\s*$/.test(line)) break;

    // Skip comments and blank lines
    if (/^\s*(#|$)/.test(line)) continue;

    const indent = getIndent(line);

    // We only care about lines with less indentation (parents)
    if (indent >= currentIndent) {
      // Count list items at same level for indexing
      if (isListItem(line) && indent === currentIndent) {
        const lvl = indent;
        listCounter.set(lvl, (listCounter.get(lvl) || 0) + 1);
      }
      continue;
    }

    // This is a parent
    const key = extractKey(line);
    if (key) {
      // Check if the next meaningful child is a list
      const childIsListItem = isNextChildList(lines, i, indent);
      if (childIsListItem) {
        // Count how many list items appear between this line and our target
        const idx = countListItemsBefore(lines, i, lineIndex, indent);
        segments.unshift({ key: `${key}[${idx}]`, line: i + 1 });
      } else {
        segments.unshift({ key, line: i + 1 });
      }
      currentIndent = indent;
    } else if (isListItem(line) && indent < currentIndent) {
      // Bare list item like "- name: foo" where we need the parent
      const listKey = extractListItemKey(line);
      if (listKey) {
        segments.unshift({ key: listKey, line: i + 1 });
      }
      currentIndent = indent;
    }

    if (currentIndent === 0) break;
  }

  return segments;
}

/**
 * Get path at a character offset in the document.
 */
export function getYamlPathAtOffset(doc: string, offset: number): PathSegment[] {
  const lines = doc.split("\n");
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    pos += lines[i].length + 1;
    if (pos > offset) {
      return getYamlPathAtLine(doc, i);
    }
  }
  return getYamlPathAtLine(doc, lines.length - 1);
}

/**
 * Format path segments as a human-readable string.
 */
export function formatYamlPath(segments: PathSegment[], separator = " > "): string {
  return segments.map((s) => s.key).join(separator);
}

/**
 * Format path segments as dot notation (for kubectl, yq, etc).
 */
export function formatYamlPathDot(segments: PathSegment[]): string {
  return segments
    .map((s) => s.key)
    .join(".")
    .replace(/\.\[/g, "[");
}

// -- Helpers ----------------------------------------------------------------

function getIndent(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

function extractKey(line: string): string | null {
  // Match "  key:" or "  key: value" but not list items
  const match = line.match(/^(\s*)([\w./$@~-]+)\s*:/);
  if (match && !line.trimStart().startsWith("-")) return match[2];

  // Match list item with inline key: "  - key: value"
  const listMatch = line.match(/^\s*-\s+([\w./$@~-]+)\s*:/);
  if (listMatch) return listMatch[1];

  return null;
}

function extractListItemKey(line: string): string | null {
  const match = line.match(/^\s*-\s+([\w./$@~-]+)\s*:/);
  return match ? match[1] : null;
}

function isListItem(line: string): boolean {
  return /^\s*-\s/.test(line);
}

function isNextChildList(lines: string[], parentIdx: number, parentIndent: number): boolean {
  for (let i = parentIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(#|$)/.test(line)) continue;
    const indent = getIndent(line);
    if (indent <= parentIndent) return false;
    return isListItem(line);
  }
  return false;
}

function countListItemsBefore(
  lines: string[],
  parentIdx: number,
  targetIdx: number,
  parentIndent: number,
): number {
  const childIndent = parentIndent + 2;
  let count = 0;
  for (let i = parentIdx + 1; i <= targetIdx; i++) {
    const line = lines[i];
    if (/^\s*(#|$)/.test(line)) continue;
    const indent = getIndent(line);
    if (indent <= parentIndent) break;
    if (isListItem(line) && indent === childIndent) {
      if (i <= targetIdx) count++;
    }
  }
  return Math.max(0, count - 1);
}
