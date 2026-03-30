/**
 * YAML linting utilities for the CodeMirror editor.
 *
 * Provides syntax validation, duplicate key detection, indentation checks,
 * and kubeconform schema validation for Kubernetes manifests.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { load as parseYamlSingle, loadAll as parseYamlAll, YAMLException } from "js-yaml";

export type LintDiagnostic = {
  from: number;
  to: number;
  severity: "error" | "warning" | "info";
  message: string;
};

// ---------------------------------------------------------------------------
// YAML syntax validation (multi-document aware)
// ---------------------------------------------------------------------------

export function validateYamlSyntax(
  doc: string,
  lineStart: (lineNo: number) => number,
  lineLength: (pos: number) => number,
  totalLines: number,
  docLength: number,
): LintDiagnostic[] {
  if (!doc.trim()) return [];
  try {
    parseYamlAll(doc);
    return [];
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (err instanceof YAMLException && err.mark) {
      const lineNo = Math.min(err.mark.line + 1, totalLines);
      const pos = lineStart(lineNo);
      return [
        {
          from: pos,
          to: Math.min(pos + lineLength(pos), docLength),
          severity: "error",
          message: err.reason || "Invalid YAML syntax",
        },
      ];
    }
    return [];
  }
}

// ---------------------------------------------------------------------------
// Duplicate key detection
// ---------------------------------------------------------------------------

export function detectDuplicateKeys(
  doc: string,
  lineStart: (lineNo: number) => number,
  lineLength: (pos: number) => number,
): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const lines = doc.split("\n");

  // Track keys per indentation scope.
  // Each entry: Map<indent, Set<key>> for current document.
  // Reset on `---` separator.
  let scopeKeys: Map<number, Map<string, number>> = new Map();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Multi-document separator resets scope
    if (/^---\s*$/.test(line) || /^\.\.\.\s*$/.test(line)) {
      scopeKeys = new Map();
      continue;
    }

    // Skip comments and blank lines
    if (/^\s*(#|$)/.test(line)) continue;

    // Match a YAML key at any indent level
    const keyMatch = line.match(/^(\s*)([\w./-]+)\s*:/);
    if (!keyMatch) continue;

    const indent = keyMatch[1].length;
    const key = keyMatch[2];

    // When we encounter a key at indent N, clear all deeper scopes (indent > N)
    for (const [scopeIndent] of scopeKeys) {
      if (scopeIndent > indent) scopeKeys.delete(scopeIndent);
    }

    if (!scopeKeys.has(indent)) {
      scopeKeys.set(indent, new Map());
    }
    const keysAtLevel = scopeKeys.get(indent)!; // eslint-disable-line @typescript-eslint/no-non-null-assertion

    if (keysAtLevel.has(key)) {
      const lineNo = i + 1;
      const pos = lineStart(lineNo);
      diagnostics.push({
        from: pos,
        to: Math.min(pos + lineLength(pos), pos + line.length),
        severity: "warning",
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        message: `Duplicate key "${key}" (first at line ${keysAtLevel.get(key)!})`,
      });
    } else {
      keysAtLevel.set(key, i + 1);
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Indentation checks
// ---------------------------------------------------------------------------

export function checkIndentation(
  doc: string,
  lineStart: (lineNo: number) => number,
  lineLength: (pos: number) => number,
): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const lines = doc.split("\n");
  let tabWarned = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;

    // Tab character in indentation
    if (/^\t/.test(line) || /^ *\t/.test(line)) {
      if (!tabWarned) {
        const lineNo = i + 1;
        const pos = lineStart(lineNo);
        diagnostics.push({
          from: pos,
          to: Math.min(pos + lineLength(pos), pos + line.length),
          severity: "error",
          message: "Tabs are not allowed in YAML - use spaces",
        });
        tabWarned = true;
      }
    }

    // Odd indentation (YAML convention is 2-space)
    const leadingSpaces = line.match(/^( +)/);
    if (leadingSpaces && leadingSpaces[1].length % 2 !== 0) {
      // Only warn if it's not a list continuation
      if (!/^\s*-\s/.test(line)) {
        const lineNo = i + 1;
        const pos = lineStart(lineNo);
        diagnostics.push({
          from: pos,
          to: Math.min(pos + leadingSpaces[1].length, pos + line.length),
          severity: "info",
          message: `Odd indentation (${leadingSpaces[1].length} spaces) - YAML convention is multiples of 2`,
        });
      }
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Kubeconform output parser
// ---------------------------------------------------------------------------

export type KubeconformDiagnostic = {
  filename: string;
  kind: string;
  name: string;
  version: string;
  status: "VALID" | "INVALID" | "ERROR" | "SKIPPED";
  msg: string;
};

export function parseKubeconformOutput(output: string): KubeconformDiagnostic[] {
  if (!output.trim()) return [];
  const results: KubeconformDiagnostic[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as KubeconformDiagnostic;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (parsed.status) results.push(parsed);
    } catch {
      // non-JSON line, skip
    }
  }
  return results;
}

/**
 * Convert kubeconform output into editor diagnostics.
 * Since kubeconform validates the whole document, errors point to line 1 by default.
 * We try to locate the relevant line by searching for the problematic field.
 */
export function kubeconformToDiagnostics(
  results: KubeconformDiagnostic[],
  doc: string,
  lineStart: (lineNo: number) => number,
  lineLength: (pos: number) => number,
  docLength: number,
): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const lines = doc.split("\n");

  for (const result of results) {
    if (result.status === "VALID" || result.status === "SKIPPED") continue;

    const msg = result.msg || "Schema validation failed";

    // Try to extract field path from the error message
    // Common patterns: "spec.replicas: Invalid type", "metadata.name is required"
    const fieldMatch =
      msg.match(
        /(?:^|[\s:])([a-zA-Z][a-zA-Z0-9./_-]*?)(?:\s*:|:?\s+(?:Invalid|is required|must be|should be|not found|additional property))/i,
      ) ??
      msg.match(/additionalProperties '([^']+)'/i) ??
      msg.match(/property "([^"]+)"/i);

    // Find the document range for this result (multi-doc awareness)
    const docRange = findDocumentRange(lines, result.kind, result.name);

    let targetLine = docRange.start;
    if (fieldMatch) {
      const fieldPath = (fieldMatch[1] || fieldMatch[1]).split(".");

      // Try nested path matching first
      const nestedLine = findNestedFieldLine(lines, fieldPath, docRange);
      if (nestedLine > 0) {
        targetLine = nestedLine;
      } else {
        // Fallback: search for the last segment within document range
        const searchKey = fieldPath[fieldPath.length - 1];
        const escaped = searchKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        for (let i = docRange.start - 1; i < docRange.end && i < lines.length; i++) {
          if (new RegExp(`^\\s*-?\\s*${escaped}\\s*:`).test(lines[i])) {
            targetLine = i + 1;
            break;
          }
        }
      }
    }

    // For "is required" errors, point to the parent block
    if (msg.includes("is required") && fieldMatch) {
      const fieldPath = (fieldMatch[1] || fieldMatch[1]).split(".");
      if (fieldPath.length > 1) {
        const parentPath = fieldPath.slice(0, -1);
        const parentLine = findNestedFieldLine(lines, parentPath, docRange);
        if (parentLine > 0) targetLine = parentLine;
      }
    }

    const pos = lineStart(targetLine);
    diagnostics.push({
      from: pos,
      to: Math.min(pos + lineLength(pos), docLength),
      severity: result.status === "INVALID" ? "warning" : "error",
      message: `[kubeconform] ${msg}`,
    });
  }

  return diagnostics;
}

// -- Kubeconform targeting helpers ------------------------------------------

/**
 * Find the line range of a specific document within a multi-doc YAML.
 */
function findDocumentRange(
  lines: string[],
  kind: string | null,
  name: string | null,
): { start: number; end: number } {
  const fallback = { start: 1, end: lines.length };
  if (!kind && !name) return fallback;

  let docStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) {
      docStart = i + 1;
      continue;
    }

    // Check if this document matches kind/name
    if (lines[i].match(new RegExp(`^kind:\\s*${kind}\\s*$`))) {
      // Verify name if provided
      if (!name) return getDocRange(lines, docStart);
      for (let j = docStart; j < lines.length && !/^---\s*$/.test(lines[j]); j++) {
        if (lines[j].match(new RegExp(`^\\s+name:\\s*${escapeRegex(name)}\\s*$`))) {
          return getDocRange(lines, docStart);
        }
      }
    }
  }
  return fallback;
}

function getDocRange(lines: string[], start: number): { start: number; end: number } {
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start: start + 1, end }; // 1-based start
}

/**
 * Walk the field path through YAML indentation to find the exact line.
 * Example: ["spec", "template", "spec", "containers"] walks indent levels.
 */
function findNestedFieldLine(
  lines: string[],
  fieldPath: string[],
  docRange: { start: number; end: number },
): number {
  if (fieldPath.length === 0) return 0;

  let currentIndent = -1;
  let pathIdx = 0;
  const targetKey = fieldPath[pathIdx];
  let escaped = escapeRegex(targetKey);

  for (let i = docRange.start - 1; i < docRange.end && i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(#|$)/.test(line) || /^---\s*$/.test(line)) continue;

    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;

    // Skip lines at wrong indent level
    if (currentIndent >= 0 && indent <= currentIndent && pathIdx > 0) {
      // We went back to a parent level - might need to keep looking
      // for another occurrence of the path root
      if (indent < currentIndent) {
        // Reset if we're at a sibling or parent of our current position
        continue;
      }
    }

    const keyMatch = line.match(/^\s*-?\s*([\w./$@~-]+)\s*:/);
    if (!keyMatch) continue;

    const key = keyMatch[1];
    const expectedIndent = currentIndent < 0 ? indent : currentIndent + 2;

    // Allow some flexibility in indentation (2 or more deeper)
    if (key === fieldPath[pathIdx] && (currentIndent < 0 || indent >= expectedIndent)) {
      if (pathIdx === fieldPath.length - 1) {
        return i + 1; // Found the target - return 1-based line
      }
      currentIndent = indent;
      pathIdx++;
      escaped = escapeRegex(fieldPath[pathIdx]); // eslint-disable-line @typescript-eslint/no-unused-vars
    }
  }

  return 0;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
