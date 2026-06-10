import { toast } from "svelte-sonner";
import { env } from "$env/dynamic/public";
import {
  hasOptedOut,
  isDoNotTrack,
  markTelemetryNoticeSeen,
  needsTelemetryNotice,
  setTelemetryOptOut,
} from "./consent";

/**
 * First-run telemetry notice — the explicit disclosure required by the
 * opt-out model (state/wau-c-spec.md §7.1). Shown once per install, only
 * when telemetry can actually collect anything: skipped without a PostHog
 * key, under Do Not Track, or after an explicit opt-out.
 */
export function maybeShowTelemetryNotice(): void {
  if (typeof window === "undefined") return;
  if (!env.PUBLIC_POSTHOG_KEY?.trim()) return;
  if (isDoNotTrack() || hasOptedOut()) return;
  if (!needsTelemetryNotice()) return;
  markTelemetryNoticeSeen();
  toast.info("Anonymous usage telemetry is on", {
    description:
      "Rozoom counts three core actions using an anonymous install hash — " +
      "no personal data, no session recording. Turn it off any time.",
    duration: 15000,
    action: {
      label: "Turn off",
      onClick: () => {
        setTelemetryOptOut(true);
        toast.success("Telemetry disabled", {
          description: "No usage data will be sent from this install.",
        });
      },
    },
  });
}
