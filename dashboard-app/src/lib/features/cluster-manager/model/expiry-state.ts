/**
 * Readable credential expiry state.
 *
 * Policy (PRD frictionless connection, P1 token closeout):
 *   A user must be able to tell, at a glance, whether the credentials in a
 *   kubeconfig are still good. Two credential kinds carry an expiry:
 *     - Bearer/JWT tokens     -> the `exp` claim (seconds since epoch).
 *     - X.509 client certs    -> the `notAfter` field of the certificate.
 *
 * This module extracts both and turns them into a single human-readable state
 * ("Expires in 3 days", "Expired 2 hours ago") so the UI never has to render a
 * raw ISO timestamp or do date math itself.
 *
 * Pure functions only: no filesystem, no network, no clock except the `now`
 * passed into `describeExpiry` (defaulted for convenience, injected in tests).
 */

export type ExpiryStatus = "valid" | "expiring-soon" | "expired" | "no-expiry";

export type ExpiryState = {
  status: ExpiryStatus;
  /** Human-readable one-liner for the UI. */
  label: string;
  /** Absolute expiry as an ISO string, or null when there is no expiry. */
  expiresAt: string | null;
  /** Whole hours until expiry (negative once expired), or null. */
  hoursRemaining: number | null;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Default window below which a still-valid credential is flagged as expiring. */
const DEFAULT_WARN_WITHIN_HOURS = 24;

/**
 * Extract the `exp` expiry of a JWT bearer token.
 * Returns null for opaque (non-JWT) tokens or a missing/invalid `exp` claim.
 */
export function parseJwtExpiry(token: string | null | undefined): Date | null {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const payload = JSON.parse(atob(parts[1])) as { exp?: unknown };
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return null;
    return new Date(payload.exp * 1000);
  } catch {
    return null;
  }
}

// --- Minimal ASN.1 / DER reader (just enough to find the cert validity) ------

type Tlv = { tag: number; contentStart: number; contentEnd: number };

const TAG_SEQUENCE = 0x30;
const TAG_UTC_TIME = 0x17;
const TAG_GENERALIZED_TIME = 0x18;

function isTimeTag(tag: number): boolean {
  return tag === TAG_UTC_TIME || tag === TAG_GENERALIZED_TIME;
}

/** Read one TLV at `offset`, or null if the length encoding runs past `end`. */
function readTlv(bytes: Uint8Array, offset: number, end: number): Tlv | null {
  if (offset + 2 > end) return null;
  const tag = bytes[offset];
  const lenByte = bytes[offset + 1];
  let length: number;
  let contentStart: number;

  if (lenByte < 0x80) {
    length = lenByte;
    contentStart = offset + 2;
  } else {
    const numLenBytes = lenByte & 0x7f;
    // Reject indefinite-length (0x80) and absurdly long encodings: DER certs
    // never need more than 4 length bytes.
    if (numLenBytes === 0 || numLenBytes > 4 || offset + 2 + numLenBytes > end) return null;
    length = 0;
    for (let i = 0; i < numLenBytes; i++) {
      length = length * 256 + bytes[offset + 2 + i];
    }
    contentStart = offset + 2 + numLenBytes;
  }

  const contentEnd = contentStart + length;
  if (contentEnd > end) return null;
  return { tag, contentStart, contentEnd };
}

function readChildren(bytes: Uint8Array, start: number, end: number): Tlv[] {
  const children: Tlv[] = [];
  let offset = start;
  while (offset < end) {
    const tlv = readTlv(bytes, offset, end);
    if (!tlv) break;
    children.push(tlv);
    offset = tlv.contentEnd;
  }
  return children;
}

/**
 * The validity is the first SEQUENCE whose two children are both time values
 * (notBefore, notAfter). Descend constructed nodes until we find it.
 */
function findNotAfter(bytes: Uint8Array, start: number, end: number): Date | null {
  let offset = start;
  while (offset < end) {
    const tlv = readTlv(bytes, offset, end);
    if (!tlv) return null;

    if (tlv.tag === TAG_SEQUENCE) {
      const children = readChildren(bytes, tlv.contentStart, tlv.contentEnd);
      if (children.length === 2 && isTimeTag(children[0].tag) && isTimeTag(children[1].tag)) {
        return parseAsn1Time(bytes, children[1]);
      }
      const found = findNotAfter(bytes, tlv.contentStart, tlv.contentEnd);
      if (found) return found;
    }

    offset = tlv.contentEnd;
  }
  return null;
}

function parseAsn1Time(bytes: Uint8Array, tlv: Tlv): Date | null {
  let text = "";
  for (let i = tlv.contentStart; i < tlv.contentEnd; i++) text += String.fromCharCode(bytes[i]);

  // RFC 5280: UTCTime is YYMMDDHHMMSSZ, GeneralizedTime is YYYYMMDDHHMMSSZ.
  const m =
    tlv.tag === TAG_UTC_TIME
      ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
      : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text);
  if (!m) return null;

  let year = Number(m[1]);
  if (tlv.tag === TAG_UTC_TIME) {
    // RFC 5280: YY < 50 -> 20YY, otherwise 19YY.
    year += year < 50 ? 2000 : 1900;
  }
  const ms = Date.UTC(
    year,
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
  return Number.isNaN(ms) ? null : new Date(ms);
}

function toDerBytes(input: string): Uint8Array | null {
  const trimmed = input.trim();
  // Accept raw PEM (strip armor + whitespace) or a bare base64 DER blob.
  const base64 = trimmed.includes("BEGIN CERTIFICATE")
    ? trimmed.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")
    : trimmed.replace(/\s+/g, "");
  if (!base64) return null;

  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Extract the `notAfter` expiry of an X.509 client certificate.
 * Accepts raw PEM or a base64-encoded DER blob (i.e. `client-certificate-data`).
 * Returns null when the input is not a parseable certificate.
 */
export function parseClientCertNotAfter(certPemOrBase64: string | null | undefined): Date | null {
  if (!certPemOrBase64) return null;
  const bytes = toDerBytes(certPemOrBase64);
  if (!bytes) return null;
  return findNotAfter(bytes, 0, bytes.length);
}

function humanizeDuration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < HOUR_MS) {
    const mins = Math.max(1, Math.round(abs / (60 * 1000)));
    return `${mins} minute${mins === 1 ? "" : "s"}`;
  }
  if (abs < 2 * DAY_MS) {
    const hours = Math.round(abs / HOUR_MS);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.round(abs / DAY_MS);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Turn an absolute expiry into a readable state. `null` means the credential
 * carries no expiry (e.g. a static bearer token), which is reported as such
 * rather than treated as valid-forever.
 */
export function describeExpiry(
  expiresAt: Date | null,
  now: number = Date.now(),
  warnWithinHours: number = DEFAULT_WARN_WITHIN_HOURS,
): ExpiryState {
  if (!expiresAt) {
    return { status: "no-expiry", label: "No expiry", expiresAt: null, hoursRemaining: null };
  }

  const remainingMs = expiresAt.getTime() - now;
  const hoursRemaining = Math.round((remainingMs / HOUR_MS) * 10) / 10;
  const expiresAtIso = expiresAt.toISOString();

  if (remainingMs <= 0) {
    return {
      status: "expired",
      label: `Expired ${humanizeDuration(remainingMs)} ago`,
      expiresAt: expiresAtIso,
      hoursRemaining,
    };
  }

  const status: ExpiryStatus = remainingMs <= warnWithinHours * HOUR_MS ? "expiring-soon" : "valid";
  return {
    status,
    label: `Expires in ${humanizeDuration(remainingMs)}`,
    expiresAt: expiresAtIso,
    hoursRemaining,
  };
}
