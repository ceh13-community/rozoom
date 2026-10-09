import { toast } from "svelte-sonner";
import { env } from "$env/dynamic/public";
import { needsConsentPrompt, setTelemetryConsent } from "./consent";
import {
  flushPendingFunnelEvents,
  initAnalytics,
  trackAppOpened,
  trackConsentGranted,
} from "./wau-c";

// Shown at most once per session: the first-scan trigger lives in the cluster
// cards, which re-run their effect on every health-check update.
let promptedThisSession = false;

/**
 * Telemetry consent prompt — the opt-in gate (U_DAW decision 2026-06-10).
 * Shown after the first scan has rendered, never during onboarding on top
 * of "Detected clusters" (Sprint 24 item 7, Сара 2026-10-06). Telemetry
 * stays completely dark until the user clicks "Allow"; "No thanks" persists
 * the refusal and never asks again. Dismissing the toast keeps the state
 * undecided, so the prompt returns after the first scan of the next launch.
 * Skipped without a PostHog key (nothing to consent to) and under Do Not
 * Track.
 */
export function maybePromptTelemetryConsent(): void {
  if (typeof window === "undefined") return;
  if (!env.PUBLIC_POSTHOG_KEY?.trim()) return;
  if (!needsConsentPrompt()) return;
  if (promptedThisSession) return;
  promptedThisSession = true;
  toast.info("Help improve Rozoom?", {
    description:
      "Share anonymous usage counts for three core actions — an anonymous " +
      "install hash, no personal data, no session recording. Off unless you allow it.",
    duration: Number.POSITIVE_INFINITY,
    action: {
      label: "Allow",
      onClick: () => {
        setTelemetryConsent("granted");
        // Start analytics right away so consent takes effect without a reload.
        initAnalytics();
        // Activation funnel: consent_granted, then app_opened with first_run=true
        // (this is the first consented launch for this install), then the
        // cluster_add / first_diagnostic steps that happened before the
        // prompt — the prompt only appears after the first scan, so without
        // the replay those steps would be lost on every fresh install.
        void trackConsentGranted()
          .then(() => trackAppOpened())
          .then(() => flushPendingFunnelEvents());
        toast.success("Telemetry enabled", {
          description: "Thanks! You can turn this off any time.",
        });
      },
    },
    cancel: {
      label: "No thanks",
      onClick: () => {
        setTelemetryConsent("denied");
        toast.success("Telemetry stays off", {
          description: "No usage data will be sent from this install.",
        });
      },
    },
  });
}
