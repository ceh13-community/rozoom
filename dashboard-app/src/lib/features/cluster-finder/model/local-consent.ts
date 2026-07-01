/**
 * P3 local-discovery consent — the opt-in gate before Rozoom reads the
 * user's kubeconfig to offer one-click connect for local-runtime clusters
 * (minikube / kind / k3d / docker-desktop).
 *
 * The scan is strictly read-only (`kubectl config view`) and nothing
 * leaves the machine, but we still ask first: privacy-by-default per the
 * Frictionless Connection UX spec. The decision is persisted in
 * localStorage so we only prompt once. Storage failures degrade to
 * "not consented", never to an implicit scan.
 */
const STORAGE_KEY = "cluster-finder:local-scan-consent";

/** Plain-language note shown next to the opt-in control. */
export const LOCAL_SCAN_PRIVACY_NOTE =
  "Read-only. Rozoom runs `kubectl config view` to list local-runtime " +
  "clusters (minikube, kind, k3d, docker-desktop). Nothing is changed, " +
  "nothing leaves this machine, and no credentials are stored until you " +
  "click Connect.";

export type LocalScanConsent = "granted" | "denied" | "undecided";

export function getLocalScanConsent(): LocalScanConsent {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "granted" || value === "denied") return value;
    return "undecided";
  } catch {
    return "undecided";
  }
}

/** True only after the user has explicitly opted in. */
export function hasLocalScanConsent(): boolean {
  return getLocalScanConsent() === "granted";
}

/** True while we have no recorded decision, so the prompt is due. */
export function needsLocalScanConsent(): boolean {
  return getLocalScanConsent() === "undecided";
}

export function setLocalScanConsent(granted: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, granted ? "granted" : "denied");
  } catch {
    /* storage unavailable — consent stays ephemeral, defaulting to off */
  }
}
