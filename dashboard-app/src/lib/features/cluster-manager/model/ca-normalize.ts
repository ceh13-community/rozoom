/**
 * CA certificate normalization.
 *
 * A kubeconfig stores the cluster CA in `certificate-authority-data` as a
 * base64-encoded PEM blob. Users, however, routinely paste the raw PEM
 * (`-----BEGIN CERTIFICATE-----`) copied from a cluster admin or cloud console.
 *
 * This module accepts either form and returns the canonical base64 value,
 * so the rest of the connection flow never has to guess what it was given.
 * The operation is idempotent: feeding an already-encoded value back in
 * returns it unchanged.
 */

const PEM_CERT_MARKER = "BEGIN CERTIFICATE";

export type CaNormalizeResult =
  | { ok: true; data: string; wasAlreadyEncoded: boolean }
  | { ok: false; reason: string };

function tryDecodeBase64(value: string): string | null {
  try {
    return atob(value);
  } catch {
    return null;
  }
}

/**
 * Normalize a CA certificate to the base64-encoded PEM form expected by
 * `certificate-authority-data`. Accepts raw PEM or an already-encoded value.
 */
export function normalizeCaCertToBase64(input: string): CaNormalizeResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, reason: "CA certificate is empty." };
  }

  // Raw PEM: the textual marker is present, so base64-encode the whole blob
  // (chains with multiple BEGIN/END blocks are encoded together, as-is).
  if (trimmed.includes(PEM_CERT_MARKER)) {
    return { ok: true, data: btoa(trimmed), wasAlreadyEncoded: false };
  }

  // Otherwise it may already be base64-encoded PEM — decode and confirm it
  // really wraps a certificate before trusting it.
  const decoded = tryDecodeBase64(trimmed);
  if (decoded && decoded.includes(PEM_CERT_MARKER)) {
    return { ok: true, data: trimmed, wasAlreadyEncoded: true };
  }

  return {
    ok: false,
    reason:
      "Input is neither a PEM certificate nor a base64-encoded PEM certificate. " +
      "Paste the CA certificate (-----BEGIN CERTIFICATE-----) or its base64-encoded form.",
  };
}
