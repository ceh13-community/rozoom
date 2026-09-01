/**
 * Masks secrets before log text leaves the app ("Copy details for support",
 * spec update-2-crash-log-path.md). Rozoom talks to clusters with bearer
 * tokens, kubeconfig client keys and base64 certificate data; any of these
 * can end up in a log line via kubectl stderr, a request dump or a stack
 * trace. Redaction is pattern based and deliberately greedy: losing a
 * harmless long base64 string from a support paste costs nothing, leaking a
 * cluster token costs a cluster.
 */

const REDACTED = "[REDACTED]";

const KUBECONFIG_SECRET_KEYS = [
  "token",
  "access-token",
  "refresh-token",
  "id-token",
  "id_token",
  "client-secret",
  "client_secret",
  "client-key-data",
  "client-certificate-data",
  "certificate-authority-data",
  "password",
  "api-key",
  "api_key",
  "apikey",
  "secret",
];

const RULES: Array<[RegExp, string]> = [
  // PEM blocks (private keys, certificates) possibly folded onto one line.
  [/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, `-----BEGIN ${REDACTED}-----`],
  // Authorization headers and CLI flags: "Authorization: Bearer x", "--token=x".
  [/(\bauthorization\b\s*[:=]\s*)(?:bearer|basic)\s+\S+/gi, `$1${REDACTED}`],
  [/(\b(?:bearer|basic)\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${REDACTED}`],
  // YAML / JSON / query-string style "key: value" for known secret keys.
  [
    new RegExp(
      `(["']?(?:${KUBECONFIG_SECRET_KEYS.join("|")})["']?\\s*[:=]\\s*)(?:["'][^"']*["']|\\S+)`,
      "gi",
    ),
    `$1${REDACTED}`,
  ],
  [new RegExp(`(--(?:${KUBECONFIG_SECRET_KEYS.join("|")})[= ])\\S+`, "gi"), `$1${REDACTED}`],
  // JSON web tokens anywhere in the line.
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, REDACTED],
  // Long base64 blobs (certificate-data, encoded kubeconfigs, secrets payloads).
  [/(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/])/g, `${REDACTED} base64`],
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
