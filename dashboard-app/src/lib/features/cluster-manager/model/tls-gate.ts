/**
 * TLS safety gate for cluster connections.
 *
 * Policy (PRD frictionless connection, P1 token closeout):
 *   - `insecure-skip-tls-verify` is never silently honored — it is an
 *     explicit block with an explanation, not a warning.
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
};

export type TlsGateResult = { allowed: true } | { allowed: false; reason: string };

function isLoopbackHost(hostname: string): boolean {
  // URL hostname for ::1 is wrapped in brackets.
  const host = hostname.replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
}

export function evaluateTlsGate(input: TlsGateInput): TlsGateResult {
  if (input.insecureSkipTlsVerify) {
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

  if (!input.hasCertificateAuthority && !loopback) {
    return {
      allowed: false,
      reason:
        "Remote cluster requires a CA certificate to verify the TLS connection. " +
        "Add the cluster CA (certificate-authority-data) to connect.",
    };
  }

  return { allowed: true };
}
