/**
 * Delete confirmation built from what the API server says it would delete.
 *
 * The dialog lists the objects from `kubectl delete --dry-run=server -o name`, not the
 * selected rows: a row count can differ from what kubectl actually removes, and the
 * user has to see the real list before anything is deleted.
 */

const MAX_LISTED_OBJECTS = 10;

/** Object names (`kind.group/name`) from `kubectl delete --dry-run=server -o name` output. */
export function parseDeleteDryRunNames(output: string | undefined | null): string[] {
  if (!output) return [];
  return output
    .split(/\r?\n/)
    .map((line) => line.replace(/\s*\(server dry run\)\s*$/, "").trim())
    .filter((line) => line.length > 0);
}

/** Number of objects reported as deleted by `kubectl delete` output. */
export function countDeletedObjects(output: string | undefined | null): number {
  if (!output) return 0;
  return output.split(/\r?\n/).filter((line) => /"\s+deleted\b/.test(line)).length;
}

export function buildDeleteConfirmMessage(
  objectNames: string[],
  options: { namespaces?: boolean } = {},
): string {
  const count = objectNames.length;
  const noun = options.namespaces
    ? count === 1
      ? "namespace"
      : "namespaces"
    : count === 1
      ? "object"
      : "objects";
  const listed = objectNames.slice(0, MAX_LISTED_OBJECTS);
  const rest = count - listed.length;
  const lines = [`Delete ${count} ${noun}? This cannot be undone.`, "", ...listed];
  if (rest > 0) lines.push(`and ${rest} more`);
  if (options.namespaces) {
    lines.push("", "Everything inside is deleted too.");
  }
  return lines.join("\n");
}
