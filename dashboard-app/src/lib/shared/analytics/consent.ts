/**
 * Telemetry consent — strict opt-in model.
 *
 * Decision: U_DAW 2026-06-10 (supersedes the opt-out model from
 * state/wau-c-spec.md §7.1). Public commitment: "no telemetry beyond
 * opt-in" — so not a single event leaves the app (including identify)
 * until the user explicitly says yes on the first-run consent prompt.
 *
 * Consent has three states:
 *   - undecided (default) — no telemetry, prompt the user on launch
 *   - granted             — telemetry on
 *   - denied              — telemetry off, never prompt again
 *
 * Do Not Track / Global Privacy Control is honoured on top: when the
 * browser sends it we neither prompt nor track, regardless of state.
 */
const CONSENT_KEY = "rozoom.telemetry_consent";

export type TelemetryConsent = "granted" | "denied" | "undecided";

/** True when the browser asks us not to track (DNT / GPC). */
export function isDoNotTrack(): boolean {
  if (typeof navigator === "undefined") return false;
  const dnt = navigator.doNotTrack ?? (window as unknown as { doNotTrack?: string }).doNotTrack;
  if (dnt === "1" || dnt === "yes") return true;
  return (navigator as unknown as { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

/** The user's recorded consent decision, or "undecided" when none exists. */
export function getTelemetryConsent(): TelemetryConsent {
  if (typeof window === "undefined") return "undecided";
  const stored = window.localStorage.getItem(CONSENT_KEY);
  return stored === "granted" || stored === "denied" ? stored : "undecided";
}

/** Persist the user's explicit consent decision. */
export function setTelemetryConsent(consent: Exclude<TelemetryConsent, "undecided">): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CONSENT_KEY, consent);
}

/** Telemetry is allowed only with explicit consent and no DNT signal. */
export function isTelemetryEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (isDoNotTrack()) return false;
  return getTelemetryConsent() === "granted";
}

/**
 * Whether the consent prompt should be shown: only while undecided and
 * not under DNT. A dismissed prompt (no click) stays undecided, so it
 * re-appears on the next launch until the user actually chooses.
 */
export function needsConsentPrompt(): boolean {
  if (typeof window === "undefined") return false;
  if (isDoNotTrack()) return false;
  return getTelemetryConsent() === "undecided";
}
