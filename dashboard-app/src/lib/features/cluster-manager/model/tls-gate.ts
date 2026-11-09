/**
 * TLS safety gate for cluster connections.
 *
 * Policy (PRD frictionless connection, P1 token closeout):
 *   - `insecure-skip-tls-verify` is never silently honored — it is an
 *     explicit block with an explanation, not a warning, unless the user
 *     asked for it for this connection.
 *   - A CA certificate is mandatory for remote clusters; loopback dev
 *     clusters (localhost / 127.x / ::1) are exempt.
 *   - Remote clusters must be reached over HTTPS.
 *
 * Pure decision function: it never touches the filesystem or network, so the
 * wizard can call it before writing any kubeconfig or probing a cluster.
 */

export type TlsGateInput = {
  /** Cluster server URL from the kubeconfig (e.g. https://api:6443). */
  server: string;
  hasCertificateAuthority: boolean;
  insecureSkipTlsVerify: boolean;
  /** The user explicitly chose to skip verification for this connection. */
  insecureSkipAccepted?: boolean;
};

export type TlsGateResult = { allowed: true } | { allowed: false; reason: string };

function isLoopbackHost(hostname: string): boolean {
  // URL hostname for ::1 is wrapped in brackets.
  const host = hostname.replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
}

export function evaluateTlsGate(input: TlsGateInput): TlsGateResult {
  if (input.insecureSkipTlsVerify && !input.insecureSkipAccepted) {
    return {
      allowed: false,
      reason:
        "insecure-skip-tls-verify disables TLS verification and exposes the connection to " +
        "man-in-the-middle attacks. Provide the cluster CA certificate to connect securely.",
    };
  }

  let url: URL;
  try {
    url = new URL(input.server);
  } catch {
    return { allowed: false, reason: "Cluster server URL is missing or invalid." };
  }

  const loopback = isLoopbackHost(url.hostname);

  if (url.protocol === "http:") {
    if (loopback) return { allowed: true };
    return {
      allowed: false,
      reason:
        "Remote cluster is served over plain HTTP, which exposes credentials in transit. " +
        "Use an HTTPS endpoint with a valid CA certificate.",
    };
  }

  if (url.protocol !== "https:") {
    return { allowed: false, reason: `Unsupported cluster server scheme: ${url.protocol}` };
  }

  if (!input.hasCertificateAuthority && !loopback && !input.insecureSkipAccepted) {
    return {
      allowed: false,
      reason:
        "Remote cluster requires a CA certificate to verify the TLS connection. " +
        "Add the cluster CA (certificate-authority-data) to connect.",
    };
  }

  return { allowed: true };
}

export class TlsBlockedError extends Error {
  override name = "TlsBlockedError";
}

const NOT_VISIBLE_ASCII = /[^\x21-\x7e]/;
const BASE64_CHARS = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Refuses values that a generated kubeconfig cannot hold as one plain YAML scalar.
 * js-yaml keeps NEL, LS and PS inside a value while kubectl ends the line there,
 * so a single pasted character can add a key the gate never saw.
 * The message never quotes the value: it may be a credential.
 */
export function assertKubeconfigValues(fields: Record<string, string>): void {
  for (const [label, value] of Object.entries(fields)) {
    const found = NOT_VISIBLE_ASCII.exec(value)?.[0];
    if (found === undefined) continue;
    const code = found.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0");
    throw new TlsBlockedError(
      `${label} contains a space, a line break or another character that is not plain ASCII ` +
        `(U+${code}). Remove it and try again.`,
    );
  }
}

/** A double-quoted YAML scalar in pure ASCII, so a line-break character can only be an escape. */
export function yamlQuoted(value: string): string {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export type KubeconfigTlsInput = {
  server: string;
  caData?: string | null;
  /** Set only by an explicit user action, never as a fallback for a missing CA. */
  skipVerification?: boolean;
};

/**
 * The TLS part of a generated kubeconfig cluster entry, to append right after
 * the `server:` line. The only writer of `insecure-skip-tls-verify`.
 * A CA always wins over a skip, because kubectl refuses to have both.
 * Throws TlsBlockedError with the gate's reason when the connection is refused.
 */
export function kubeconfigTlsYaml(input: KubeconfigTlsInput): string {
  assertKubeconfigValues({ "API server URL": input.server });
  const caData = input.caData?.trim();
  if (caData && !(BASE64_CHARS.test(caData) && caData.length % 4 === 0)) {
    throw new TlsBlockedError("CA certificate data must be valid base64.");
  }
  const skip = !caData && input.skipVerification === true;
  const gate = evaluateTlsGate({
    server: input.server,
    hasCertificateAuthority: Boolean(caData),
    insecureSkipTlsVerify: skip,
    insecureSkipAccepted: skip,
  });
  if (!gate.allowed) throw new TlsBlockedError(gate.reason);
  if (caData) return `\n    certificate-authority-data: ${caData}`;
  return skip ? "\n    insecure-skip-tls-verify: true" : "";
}
