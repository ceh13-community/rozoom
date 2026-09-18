/**
 * Plain-language mapping for cluster-connect failures.
 *
 * The connect wizards used to surface raw `Error.message` values (kubectl /
 * fetch / TLS internals) directly in the UI. Per the frictionless-connection
 * UX spec, the three failure classes a first-time user actually hits — expired
 * token, unreachable server, CA mismatch — get actionable copy; anything else
 * falls through verbatim so real diagnostics are never hidden.
 */

const TOKEN_EXPIRED =
  "The token is expired or invalid. Get a new one from your cluster administrator or recreate the service account.";

const CA_MISMATCH =
  "The CA certificate does not match this server. Make sure you are using the CA of this exact cluster.";

const UNKNOWN_FAILURE = "Connection failed for an unknown reason. Check the app logs for details.";

const TOKEN_PATTERNS = [
  /unauthorized/i,
  /\b401\b/,
  /token (?:is |has )?expired/i,
  /invalid bearer token/i,
  /provide credentials/i,
];

const NETWORK_PATTERNS = [
  /econnrefused/i,
  /connection refused/i,
  /enotfound/i,
  /getaddrinfo/i,
  /etimedout/i,
  /timed? ?out/i,
  /no route to host/i,
  /dial tcp/i,
  /fetch failed/i,
  /network error/i,
  /ehostunreach/i,
];

const TLS_PATTERNS = [
  /x509/i,
  /certificate/i,
  /unable_to_verify/i,
  /self.signed/i,
  /\btls\b/i,
  /\bssl\b/i,
];

export function humanizeConnectError(e: unknown, serverUrl?: string): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (!raw.trim()) return UNKNOWN_FAILURE;

  if (TOKEN_PATTERNS.some((p) => p.test(raw))) return TOKEN_EXPIRED;
  if (NETWORK_PATTERNS.some((p) => p.test(raw))) {
    return `Could not reach ${serverUrl?.trim() || "the API server"}. Check the server address and your network connection.`;
  }
  if (TLS_PATTERNS.some((p) => p.test(raw))) return CA_MISMATCH;

  return raw;
}
