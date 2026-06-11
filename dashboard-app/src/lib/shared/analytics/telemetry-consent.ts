import { toast } from "svelte-sonner";
import { env } from "$env/dynamic/public";
import { needsConsentPrompt, setTelemetryConsent } from "./consent";
import { initAnalytics } from "./wau-c";

/**
 * First-run telemetry consent prompt — the opt-in gate (U_DAW decision
 * 2026-06-10). Telemetry stays completely dark until the user clicks
 * "Allow"; "No thanks" persists the refusal and never asks again.
 * Dismissing the toast keeps the state undecided, so the prompt returns
 * on the next launch. Skipped without a PostHog key (nothing to consent
 * to) and under Do Not Track.
 */
export function maybePromptTelemetryConsent(): void {
  if (typeof window === "undefined") return;
  if (!env.PUBLIC_POSTHOG_KEY?.trim()) return;
  if (!needsConsentPrompt()) return;
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
