/** Shown after this many milliseconds, so a long scan does not look stuck. */
export const LOADING_ELAPSED_AFTER_MS = 3000;

/** "still running, 5 s" once a load takes longer than a few seconds; empty before. */
export function loadingElapsedLabel(elapsedMs: number): string {
  if (elapsedMs < LOADING_ELAPSED_AFTER_MS) return "";
  return `still running, ${Math.floor(elapsedMs / 1000)} s`;
}
