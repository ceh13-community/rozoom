/**
 * Telemetry consent — opt-out model with an explicit first-run notice and
 * Do Not Track support. Decision: state/wau-c-spec.md §7.1 (PM approved).
 *
 * Telemetry is ON by default for an OSS K8s tool (no forced auth), but:
 *   - users can turn it off with a single toggle (persisted), and
 *   - we always honour the browser Do Not Track signal.
 */
const OPT_OUT_KEY = "rozoom.telemetry_optout";
const NOTICE_SEEN_KEY = "rozoom.telemetry_notice_seen";

/** True when the browser asks us not to track (DNT / GPC). */
export function isDoNotTrack(): boolean {
  if (typeof navigator === "undefined") return false;
  const dnt = navigator.doNotTrack ?? (window as unknown as { doNotTrack?: string }).doNotTrack;
  if (dnt === "1" || dnt === "yes") return true;
  return (navigator as unknown as { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

/** Whether the user has explicitly opted out of telemetry. */
export function hasOptedOut(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(OPT_OUT_KEY) === "true";
}

/** Persist the user's telemetry choice. */
export function setTelemetryOptOut(optOut: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(OPT_OUT_KEY, optOut ? "true" : "false");
}

/** Telemetry is allowed only when DNT is off and the user hasn't opted out. */
export function isTelemetryEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (isDoNotTrack()) return false;
  return !hasOptedOut();
}

/** Whether the first-run telemetry notice still needs to be shown. */
export function needsTelemetryNotice(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(NOTICE_SEEN_KEY) !== "true";
}

/** Mark the first-run telemetry notice as acknowledged. */
export function markTelemetryNoticeSeen(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NOTICE_SEEN_KEY, "true");
}
