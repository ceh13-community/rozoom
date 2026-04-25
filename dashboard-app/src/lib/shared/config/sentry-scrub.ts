/**
 * Sentry event scrubber - strips credentials and PII before events leave
 * the process.
 *
 * Wired as `beforeSend` / `beforeBreadcrumb` in Sentry.init(). Walks the
 * entire event tree and replaces matches of each rule with a fixed
 * placeholder. Matches are greedy enough to cover realistic payloads
 * (YAML snippets in stderr, HTTP headers, CLI arg strings) without
 * mangling harmless text.
 *
 * Ref: Phase 8.2 in ROADMAP.md, OWASP Secrets in Logs cheatsheet.
 */

import type { Breadcrumb, ErrorEvent, Event } from "@sentry/sveltekit";

const REDACTED = "[REDACTED]";
const KUBECONFIG_PATH = "[kubeconfig-path]";

/**
 * Ordered list of scrub rules. Each rule keeps a capture group for the
 * key/prefix and replaces only the secret value with REDACTED so the
 * shape of the surrounding message stays readable ("token: [REDACTED]"
 * is more useful for debugging than a blanked-out line).
 */
export const SCRUB_RULES: ReadonlyArray<{
  name: string;
  pattern: RegExp;
  replace: (match: string, ...groups: string[]) => string;
}> = [
  // Kubeconfig YAML fields - matches token:, client-key-data:,
  // client-certificate-data:, certificate-authority-data: on their own line.
  // Stops at whitespace/newline so adjacent YAML is untouched.
  {
    name: "kubeconfig-yaml-fields",
    pattern:
      /(\b(?:token|client-key-data|client-certificate-data|certificate-authority-data)\s*:\s*)(\S+)/gi,
    replace: (_m, prefix) => `${prefix}${REDACTED}`,
  },
  // OIDC client secret passed as a CLI arg (--oidc-client-secret=VALUE).
  {
    name: "oidc-client-secret",
    pattern: /(--oidc-client-secret=)([^"\s&]+)/gi,
    replace: (_m, prefix) => `${prefix}${REDACTED}`,
  },
  // Authorization header: takes the whole value after the colon up to end
  // of line. Covers "Bearer <tok>", "Basic <b64>", and custom schemes.
  {
    name: "authorization-header",
    pattern: /(authorization\s*:\s*)([^\r\n]+)/gi,
    replace: (_m, prefix) => `${prefix}${REDACTED}`,
  },
  // Bare "Bearer <token>" without the Authorization prefix (e.g. when
  // stored as a plain header value in a JS object). Keeps the scheme
  // word so debug context survives. Threshold is deliberately low - a
  // false-positive redaction of "Bearer Grylls" is better than leaking a
  // real short-lived token.
  {
    name: "bare-bearer-token",
    pattern: /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{3,})/g,
    replace: (_m, prefix) => `${prefix}${REDACTED}`,
  },
  // Common password field in CLI args or URLs.
  {
    name: "password-field",
    pattern: /(\bpassword\s*[:=]\s*)(\S+)/gi,
    replace: (_m, prefix) => `${prefix}${REDACTED}`,
  },
  // JWT-like tokens that appear without a key prefix (eyJ... three dot-
  // separated base64url segments). Catches copy-pasted raw tokens.
  // Third segment allowed shorter (some JWTs use HS256 with tiny sigs).
  {
    name: "bare-jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g,
    replace: () => REDACTED,
  },
  // Kubeconfig absolute paths - POSIX (Linux / macOS). macOS paths
  // commonly contain spaces (Application Support). We lazy-match up to
  // the known suffix (kubeconfig, .kube/config, or configs/<any>.yaml).
  {
    name: "kubeconfig-path-posix",
    pattern:
      /(?:\/home\/[^/\s]+|\/Users\/[^/\s]+)[^\r\n"']*?(?:\.kube\/config|kubeconfig(?:\.ya?ml)?|configs\/[A-Za-z0-9_-]+\.ya?ml)/gi,
    replace: () => KUBECONFIG_PATH,
  },
  // Kubeconfig absolute paths - Windows. Uses backslashes; the `\\`
  // separator means we have to escape carefully.
  {
    name: "kubeconfig-path-windows",
    pattern:
      /C:\\Users\\[^\\\s]+\\[^\r\n"']*?(?:\.kube\\config|kubeconfig(?:\.ya?ml)?|configs\\[A-Za-z0-9_-]+\.ya?ml)/gi,
    replace: () => KUBECONFIG_PATH,
  },
];

/**
 * Scrub a single string by applying every rule in order. Idempotent -
 * running twice on the same string produces the same result.
 */
export function scrubString(input: string): string {
  if (!input) return input;
  let out = input;
  for (const rule of SCRUB_RULES) {
    out = out.replace(rule.pattern, rule.replace);
  }
  return out;
}

type JsonLike =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonLike[]
  | { [k: string]: JsonLike };

const MAX_DEPTH = 12;

/**
 * Walk an arbitrary JSON-like value and scrub every string encountered.
 * Bounded depth keeps us safe against circular / deeply-nested objects.
 */
export function scrubValue<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH) return value;
  if (typeof value === "string") return scrubString(value) as unknown as T;
  if (Array.isArray(value)) {
    return value.map((v) => scrubValue(v as JsonLike, depth + 1)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, JsonLike>);
    const scrubbed: Record<string, JsonLike> = {};
    for (const [k, v] of entries) {
      scrubbed[k] = scrubValue(v, depth + 1);
    }
    return scrubbed as unknown as T;
  }
  return value;
}

/**
 * Sentry beforeSend hook. Scrubs message, exception values, breadcrumbs,
 * request headers/body, extra, contexts, and tags.
 *
 * Returns null only if the scrubbed event would be entirely empty after
 * the pass (defensive; in practice we always return the scrubbed event).
 */
export function scrubEvent(event: Event): Event | null {
  if (event.message) {
    event.message = scrubString(event.message);
  }

  if (event.exception?.values) {
    event.exception.values = event.exception.values.map((ex) => ({
      ...ex,
      value: ex.value ? scrubString(ex.value) : ex.value,
      stacktrace: ex.stacktrace
        ? {
            ...ex.stacktrace,
            frames: ex.stacktrace.frames?.map((f) => ({
              ...f,
              vars: f.vars ? scrubValue(f.vars) : f.vars,
              pre_context: f.pre_context?.map(scrubString),
              context_line: f.context_line ? scrubString(f.context_line) : f.context_line,
              post_context: f.post_context?.map(scrubString),
            })),
          }
        : ex.stacktrace,
    }));
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  }

  if (event.request) {
    event.request = scrubValue(event.request);
  }

  if (event.extra) {
    event.extra = scrubValue(event.extra);
  }

  if (event.contexts) {
    event.contexts = scrubValue(event.contexts);
  }

  if (event.tags) {
    event.tags = scrubValue(event.tags);
  }

  return event;
}

/** Sentry beforeBreadcrumb hook. Scrubs message + data payload. */
export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  const next: Breadcrumb = { ...crumb };
  if (next.message) next.message = scrubString(next.message);
  if (next.data) next.data = scrubValue(next.data);
  return next;
}

/** Narrowed overload for ErrorEvent specifically (same scrubbing). */
export function scrubErrorEvent(event: ErrorEvent): ErrorEvent | null {
  return scrubEvent(event) as ErrorEvent | null;
}
