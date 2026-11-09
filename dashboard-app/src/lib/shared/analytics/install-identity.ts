/**
 * Pseudonymous install identity for WAU-C telemetry — no account data, no auth.
 *
 * install_id is a random UUID generated once per install and persisted in
 * localStorage. The value reported to PostHog is never the raw id but
 * SHA-256(cluster_id + install_id), so the backend can count unique users
 * without ever seeing the install_id or cluster identity in clear.
 */
const INSTALL_ID_KEY = "rozoom.install_id";

/** The persisted install id, or null when none was created yet. Never writes. */
export function peekInstallId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(INSTALL_ID_KEY);
}

/** Return the persisted install id, generating and storing one on first use. */
export function getInstallId(): string {
  if (typeof window === "undefined") return "";
  let id = peekInstallId();
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(INSTALL_ID_KEY, id);
  }
  return id;
}

/** SHA-256(clusterId + installId) as a lowercase hex string. */
export async function computeAnonymousHash(clusterId: string, installId: string): Promise<string> {
  const data = new TextEncoder().encode(`${clusterId}${installId}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * SHA-256(install_id): the distinct_id PostHog stores for this install. One function
 * for the sender (wau-c) and for the Fleet Settings row, so what is shown is what is sent.
 * `create: false` only reads: null when no install id exists yet, so a screen can show
 * the hash without minting an id for someone who never opted in.
 */
export async function getInstallHash(options: { create?: boolean } = {}): Promise<string | null> {
  const id = options.create === false ? peekInstallId() : getInstallId();
  if (!id) return null;
  return computeAnonymousHash("", id);
}
