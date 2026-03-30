/**
 * Multi-document YAML parsing utilities.
 *
 * Splits a YAML document on `---` separators and extracts
 * kind, apiVersion, and name metadata for each sub-document.
 */

export type YamlDocumentInfo = {
  index: number;
  startLine: number; // 1-based
  endLine: number; // 1-based
  startOffset: number;
  endOffset: number;
  kind: string | null;
  apiVersion: string | null;
  name: string | null;
};

/**
 * Parse multi-document YAML into an array of document info objects.
 */
export function parseYamlDocuments(doc: string): YamlDocumentInfo[] {
  const lines = doc.split("\n");
  const documents: YamlDocumentInfo[] = [];

  let docStart = 0;
  let docStartOffset = 0;
  let docIndex = 0;
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineEnd = offset + line.length + 1; // +1 for \n

    if (/^---\s*$/.test(line) && i > 0) {
      // End previous document, start new one
      if (docStart < i) {
        documents.push(buildDocInfo(lines, docIndex, docStart, i - 1, docStartOffset, offset - 1));
        docIndex++;
      }
      docStart = i + 1;
      docStartOffset = lineEnd;
    }

    offset = lineEnd;
  }

  // Final document
  if (docStart < lines.length) {
    const lastNonEmpty = findLastNonEmptyLine(lines, docStart);
    if (lastNonEmpty >= docStart) {
      documents.push(
        buildDocInfo(lines, docIndex, docStart, lastNonEmpty, docStartOffset, doc.length),
      );
    }
  }

  return documents;
}

/**
 * Get the document at a given character offset.
 */
export function getDocumentAtOffset(
  docs: YamlDocumentInfo[],
  offset: number,
): YamlDocumentInfo | null {
  for (const doc of docs) {
    if (offset >= doc.startOffset && offset <= doc.endOffset) return doc;
  }
  return docs.length > 0 ? docs[0] : null;
}

/**
 * Get the document at a given line number (1-based).
 */
export function getDocumentAtLine(
  docs: YamlDocumentInfo[],
  lineNo: number,
): YamlDocumentInfo | null {
  for (const doc of docs) {
    if (lineNo >= doc.startLine && lineNo <= doc.endLine) return doc;
  }
  return null;
}

/**
 * Format document label for navigation UI.
 */
export function formatDocLabel(doc: YamlDocumentInfo): string {
  const kind = doc.kind || "Unknown";
  const name = doc.name || "unnamed";
  return `${kind}/${name}`;
}

// -- Helpers ----------------------------------------------------------------

function buildDocInfo(
  lines: string[],
  index: number,
  startLine: number,
  endLine: number,
  startOffset: number,
  endOffset: number,
): YamlDocumentInfo {
  let kind: string | null = null;
  let apiVersion: string | null = null;
  let name: string | null = null;

  for (let i = startLine; i <= endLine && i < lines.length; i++) {
    const line = lines[i];
    if (!kind) {
      const km = line.match(/^kind:\s*(\S+)/);
      if (km) kind = km[1];
    }
    if (!apiVersion) {
      const am = line.match(/^apiVersion:\s*(\S+)/);
      if (am) apiVersion = am[1];
    }
    if (!name) {
      const nm = line.match(/^\s{2}name:\s*(\S+)/);
      if (nm) name = nm[1];
    }
    if (kind && apiVersion && name) break;
  }

  return {
    index,
    startLine: startLine + 1, // convert to 1-based
    endLine: endLine + 1,
    startOffset,
    endOffset,
    kind,
    apiVersion,
    name,
  };
}

function findLastNonEmptyLine(lines: string[], from: number): number {
  for (let i = lines.length - 1; i >= from; i--) {
    if (lines[i].trim()) return i;
  }
  return from;
}
