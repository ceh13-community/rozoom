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
  const caData = input.caData?.trim();
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
