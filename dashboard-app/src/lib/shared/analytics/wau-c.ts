import posthog from "posthog-js";
import { env } from "$env/dynamic/public";
import { getInstallId, computeAnonymousHash } from "./install-identity";
import { isTelemetryEnabled } from "./consent";

/**
 * WAU-C (Weekly Active Users — Core) instrumentation.
 *
 * Spec: state/wau-c-spec.md (D6, Final 2026-06-06, Сара/PM).
 * Tracks exactly three Core Actions, nothing else. Autocapture and
 * session recording are OFF by design — DevOps audience + privacy-first.
 *
 * Identity is an anonymous install-hash = SHA-256(cluster_id + install_id),
 * no PII. Telemetry is strictly opt-in (U_DAW decision 2026-06-10): nothing
 * is initialised or sent until the user grants consent on the first-run
 * prompt — see ./consent and ./telemetry-consent.
 */
export type CoreAction =
  | "rozoom_dashboard_viewed"
  | "rozoom_workload_detail_opened"
  | "rozoom_resource_action_taken";

let initialized = false;

/**
 * Initialise PostHog once, only when the user has granted consent and a
 * project key is configured. Safe to call on every app mount and again right
 * after consent is granted — no-ops after the first successful init and while
 * consent/key is absent. Never throws into the caller.
 */
export function initAnalytics(): void {
  if (initialized) return;
  if (typeof window === "undefined") return;

  const key = env.PUBLIC_POSTHOG_KEY?.trim();
  if (!key) return; // No key configured (e.g. local dev without telemetry) — stay dark.
  if (!isTelemetryEnabled()) return;

  try {
    posthog.init(key, {
      api_host: env.PUBLIC_POSTHOG_HOST?.trim() || "https://us.i.posthog.com",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      person_profiles: "identified_only",
    });
    initialized = true;
  } catch {
    // Telemetry must never break the app. Swallow and stay uninitialised.
    initialized = false;
  }
}

/**
 * Emit a Core Action. Resolves the anonymous identity lazily so we never block
 * first paint. No-ops silently when analytics is not initialised.
 */
export async function trackCoreAction(event: CoreAction, clusterId: string): Promise<void> {
  if (!initialized) return;
  // Re-check consent on every emit so a withdrawal after init takes effect
  // immediately, not on the next reload.
  if (!isTelemetryEnabled()) return;
  try {
    const installId = getInstallId();
    const userHash = await computeAnonymousHash(clusterId, installId);
    const clusterHash = await computeAnonymousHash(clusterId, "");
    posthog.identify(userHash);
    posthog.capture(event, {
      cluster_id: clusterHash,
      source: "web",
    });
  } catch {
    // Best-effort. A failed metric must never surface to the user.
  }
}
