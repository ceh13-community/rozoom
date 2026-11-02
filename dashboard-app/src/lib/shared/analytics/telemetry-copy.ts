/**
 * User-facing telemetry copy (card mM8lRQ78, designer spec 2026-11-02, final).
 *
 * One place for the strings so the consent toast and Fleet Settings never drift
 * apart: both must name the processor and region and link the privacy notice.
 * English only; the app has no UI localisation yet, the Ukrainian version lives
 * on rozoom.app/privacy (PM decision 2026-11-02).
 */
export const PRIVACY_POLICY_URL = "https://rozoom.app/privacy";
export const PRIVACY_POLICY_LABEL = "Privacy policy →";

/** Toast description; the title "Help improve Rozoom?" stays as is. */
export const CONSENT_PROMPT_DESCRIPTION =
  "Anonymous usage counts only, no personal data, sent to PostHog (EU, Frankfurt).";

/** Fleet Settings body under the unchanged "Usage telemetry" title. */
export const TELEMETRY_SETTINGS_DESCRIPTION =
  "Anonymous usage counts only, no personal data, sent to PostHog (EU, Frankfurt) when enabled.";
