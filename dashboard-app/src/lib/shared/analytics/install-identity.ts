/**
 * Anonymous identity for WAU-C telemetry — no PII, no auth.
 *
 * install_id is a random UUID generated once per install and persisted in
 * localStorage. The value reported to PostHog is never the raw id but
 * SHA-256(cluster_id + install_id), so the backend can count unique users
 * without ever seeing the install_id or cluster identity in clear.
 */
const INSTALL_ID_KEY = "rozoom.install_id";

/** Return the persisted install id, generating and storing one on first use. */
export function getInstallId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(INSTALL_ID_KEY);
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
