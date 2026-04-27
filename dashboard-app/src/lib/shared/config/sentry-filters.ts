/**
 * Sentry pre-send filters.
 *
 * Two concerns, kept separate so we can reason about them:
 *
 *   1. HMR_ERROR_PATTERNS - Vite/HMR artefacts that fire transiently
 *      during dev when modules swap out. Never appear in a prod build
 *      because there is no HMR in prod. Collected by observing the
 *      dev-time Sentry stream (local-debug env) after a burst of edits.
 *
 *   2. HMR_URL_PATTERNS - stack-trace URLs that indicate the error
 *      came from Vite's own HMR client rather than application code.
 *      Used as Sentry `denyUrls` so anything originating there is
 *      dropped regardless of the error message.
 *
 * Both lists are exported so tests can assert against them and the
 * hooks can pass them straight to `Sentry.init`.
 */

export const HMR_ERROR_PATTERNS: ReadonlyArray<RegExp> = [
  // Vite module graph drift when a new chunk is served but the browser
  // still holds a stale import reference.
  /Importing a module script failed/i,
  // Same root cause, different symptom: an imported namespace is
  // undefined before the new module finishes loading.
  /undefined is not an object \(evaluating 'module\.default'\)/,
  /Cannot read properties of undefined \(reading 'default'\)/,
  // Tied to Vite HMR: when a boundary accepts an update, lifecycle
  // cleanup of the old module can yield transient null getters.
  /undefined is not an object \(evaluating '(first_child_getter|next_sibling_getter)\.call'\)/,
];

// Note: a broader `ReferenceError: Can't find variable: <id>` pattern was
// considered for transient stale-closure reloads during HMR. It was not
// included because Safari emits the same wording for legitimate
// production failures (cross-frame iframe access, late-binding globals,
// feature-detection probes). HMR-originating ReferenceErrors are dropped
// via HMR_URL_PATTERNS / Sentry `denyUrls` based on their stack origin,
// which keeps prod visibility intact.

export const HMR_URL_PATTERNS: ReadonlyArray<RegExp> = [
  /\/@vite\//,
  /node_modules\/\.vite\//,
  /\?t=\d{10,}/, // Vite's HMR cache-busting query (?t=<timestamp>)
];

export function matchesHmrError(message: string | undefined): boolean {
  if (!message) return false;
  return HMR_ERROR_PATTERNS.some((p) => p.test(message));
}

export function matchesHmrUrl(url: string | undefined): boolean {
  if (!url) return false;
  return HMR_URL_PATTERNS.some((p) => p.test(url));
}
