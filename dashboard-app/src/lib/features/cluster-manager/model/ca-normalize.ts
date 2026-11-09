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

import { TlsBlockedError } from "./tls-gate";

const PEM_CERT_MARKER = "BEGIN CERTIFICATE";
const PEM_BLOCK = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g;
const NOT_IN_A_PEM_FILE = /[^\x20-\x7e\t\r\n]/;

export type CaNormalizeResult =
  | { ok: true; data: string; wasAlreadyEncoded: boolean }
  | { ok: false; reason: string };

/**
 * A single-line input turns pasted line breaks into spaces or drops them, and
 * PEM does not parse without the break after BEGIN and before END.
 */
function restorePemLineBreaks(flat: string): string {
  return [...flat.matchAll(PEM_BLOCK)]
    .map(([, body]) => {
      const lines = body.replace(/\s+/g, "").match(/.{1,64}/g) ?? [];
      return ["-----BEGIN CERTIFICATE-----", ...lines, "-----END CERTIFICATE-----"].join("\n");
    })
    .join("\n");
}

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

  // Checked before anything is stripped, so NEL, LS and PS are refused and not cleaned up.
  if (NOT_IN_A_PEM_FILE.test(input)) {
    return {
      ok: false,
      reason: "CA certificate contains characters a PEM file cannot have. Copy it again.",
    };
  }

  // Raw PEM: the textual marker is present, so base64-encode the whole blob
  // (chains with multiple BEGIN/END blocks are encoded together, as-is).
  if (trimmed.includes(PEM_CERT_MARKER)) {
    const pem = trimmed.includes("\n") ? trimmed : restorePemLineBreaks(trimmed);
    return { ok: true, data: btoa(pem), wasAlreadyEncoded: false };
  }

  // Otherwise it may already be base64-encoded PEM — decode and confirm it
  // really wraps a certificate before trusting it.
  // Wrapped output of `base64` is common, and a kubeconfig value has to be one line.
  const compact = trimmed.replace(/\s+/g, "");
  const decoded = tryDecodeBase64(compact);
  if (decoded && decoded.includes(PEM_CERT_MARKER)) {
    return { ok: true, data: compact, wasAlreadyEncoded: true };
  }

  return {
    ok: false,
    reason:
      "Input is neither a PEM certificate nor a base64-encoded PEM certificate. " +
      "Paste the CA certificate (-----BEGIN CERTIFICATE-----) or its base64-encoded form.",
  };
}

/**
 * What a connect form hands to a kubeconfig generator: base64 from PEM or base64,
 * undefined when the field is empty.
 * Throws TlsBlockedError with a form-ready reason when the field holds anything else.
 */
export function caDataFromForm(input: string): string | undefined {
  if (!input.trim()) return undefined;
  const result = normalizeCaCertToBase64(input);
  if (!result.ok) throw new TlsBlockedError(result.reason);
  return result.data;
}
