/**
 * Resource Diff (#2)
 *
 * Compare two K8s resources side-by-side.
 * Produces a line-by-line diff with additions, deletions, and unchanged.
 */

export type DiffLineKind = "added" | "removed" | "unchanged" | "modified";

export type DiffLine = {
  kind: DiffLineKind;
  lineNumber: number;
  content: string;
  otherContent?: string;
};

export type ResourceDiffResult = {
  lines: DiffLine[];
  additions: number;
  deletions: number;
  modifications: number;
  identical: boolean;
};

export function computeResourceDiff(left: string, right: string): ResourceDiffResult {
  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  const lines: DiffLine[] = [];
  let additions = 0;
  let deletions = 0;
  let modifications = 0;

  const maxLen = Math.max(leftLines.length, rightLines.length);

  for (let i = 0; i < maxLen; i++) {
    const l = i < leftLines.length ? leftLines[i] : undefined;
    const r = i < rightLines.length ? rightLines[i] : undefined;

    if (l === undefined && r !== undefined) {
      lines.push({ kind: "added", lineNumber: i + 1, content: r });
      additions++;
    } else if (l !== undefined && r === undefined) {
      lines.push({ kind: "removed", lineNumber: i + 1, content: l });
      deletions++;
    } else if (l === r) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- l === r and at least one is defined (covered by prior branches)
      lines.push({ kind: "unchanged", lineNumber: i + 1, content: l! });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- r is defined (undefined case handled by first branch)
      lines.push({ kind: "modified", lineNumber: i + 1, content: r!, otherContent: l });
      modifications++;
    }
  }

  return {
    lines,
    additions,
    deletions,
    modifications,
    identical: additions === 0 && deletions === 0 && modifications === 0,
  };
}
