import posthog from "posthog-js";
import { env } from "$env/dynamic/public";
import { getInstallId, computeAnonymousHash } from "./install-identity";
import { isTelemetryEnabled } from "./consent";

/**
 * WAU-C (Weekly Active Users — Core) + activation-funnel instrumentation.
 *
 * Spec: state/wau-c-spec.md (D6, Final 2026-06-06, Сара/PM).
 * The three Core Actions below are the *end* of the user path; the funnel
 * events (app_opened → consent_granted → cluster_add_* → first_diagnostic_rendered)
 * light up the path *between download and dashboard* so a download that dies
 * at "add cluster" is visible to us instead of silently absent from PostHog.
 *
 * Autocapture and session recording are OFF by design — DevOps audience +
 * privacy-first. Identity is an anonymous install-hash = SHA-256(install_id),
 * no PII. Telemetry is strictly opt-in (U_DAW decision 2026-06-10): nothing
 * is initialised or sent until the user grants consent — see ./consent and
 * ./telemetry-consent.
 */
export type CoreAction =
  | "rozoom_dashboard_viewed"
  | "rozoom_workload_detail_opened"
  | "rozoom_resource_action_taken";

/** Bucketed connect-failure class, never the raw error (which may contain URLs). */
type ConnectErrorClass = "auth" | "network" | "tls" | "unknown";

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
 * Install-level identity: SHA-256(install_id). Stable across clusters and
 * sessions, so the activation funnel can join app-level and cluster-level
 * events by distinct_id. The raw install_id never leaves the app.
 */
async function installIdentity(): Promise<string> {
  return computeAnonymousHash("", getInstallId());
}

async function clusterHash(clusterId: string): Promise<string | null> {
  try {
    return await computeAnonymousHash(clusterId, "");
  } catch {
    // crypto.subtle unavailable — stay dark rather than send a malformed event.
    return null;
  }
}

/**
 * Internal capture: lazy init + consent re-check + identify + capture.
 * Returns true only when an event was actually emitted, so one-shot
 * bookkeeping (first-run flag, first-diagnostic flag) can be gated on a
 * real send rather than a no-op attempt made before consent was granted.
 */
async function capture(event: string, props: Record<string, unknown> = {}): Promise<boolean> {
  // Lazy init: child onMount runs before the root layout's in Svelte, so a
  // deep launch straight into a cluster route would otherwise emit before
  // initAnalytics() ever ran. Idempotent and consent-gated, so safe here.
  initAnalytics();
  if (!initialized) return false;
  // Re-check consent on every emit so a withdrawal after init takes effect
  // immediately, not on the next reload.
  if (!isTelemetryEnabled()) return false;
  try {
    posthog.identify(await installIdentity());
    posthog.capture(event, { source: "web", ...props });
    return true;
  } catch {
    // Best-effort. A failed metric must never surface to the user.
    return false;
  }
}

/**
 * Emit a Core Action. Resolves the anonymous identity lazily so we never block
 * first paint. No-ops silently when analytics is not initialised.
 */
export async function trackCoreAction(event: CoreAction, clusterId: string): Promise<void> {
  const hash = await clusterHash(clusterId);
  if (hash === null) return;
  await capture(event, { cluster_id: hash });
}

// ── Activation funnel ───────────────────────────────────────────────

const APP_OPENED_KEY = "rozoom.app_opened";

function wasOpenedBefore(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(APP_OPENED_KEY) === "1";
}

function markOpened(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(APP_OPENED_KEY, "1");
}

function detectPlatform(): string {
  if (typeof navigator === "undefined") return "unknown";
  // navigator.platform is deprecated, so derive the bucket from the UA string
  // (works in the Tauri webview, which embeds the host OS in its UA).
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("windows")) return "windows";
  if (ua.includes("macintosh") || ua.includes("darwin") || ua.includes("mac os")) return "macos";
  if (ua.includes("linux") || ua.includes("x11")) return "linux";
  return "unknown";
}

function appVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "unknown";
}

/**
 * App opened. Fired from the root layout on every mount but — like every
 * event here — only actually emitted once consent is granted. The persisted
 * first-run flag is only flipped after a real send, so the very first
 * consented launch reports `first_run: true` even though consent itself was
 * granted a moment earlier in that same session.
 */
export async function trackAppOpened(): Promise<void> {
  const firstRun = !wasOpenedBefore();
  const fired = await capture("rozoom_app_opened", {
    first_run: firstRun,
    app_version: appVersion(),
    platform: detectPlatform(),
  });
  if (fired) markOpened();
}

/** Consent granted on the first-run prompt. */
export async function trackConsentGranted(): Promise<void> {
  await capture("rozoom_consent_granted");
}

/** A cluster add (kubeconfig import / paste / selection) was attempted. */
export async function trackClusterAddAttempted(clusterId: string): Promise<void> {
  const hash = await clusterHash(clusterId);
  if (hash === null) return;
  await capture("rozoom_cluster_add_attempted", { cluster_id: hash });
}

/** A cluster add failed; `errorClass` is a bucket, never the raw message. */
export async function trackClusterAddFailed(
  clusterId: string,
  errorClass: ConnectErrorClass,
): Promise<void> {
  const hash = await clusterHash(clusterId);
  if (hash === null) return;
  await capture("rozoom_cluster_add_failed", {
    cluster_id: hash,
    error_class: errorClass,
  });
}

const FIRST_DIAG_KEY = "rozoom.first_diagnostic_rendered";

function loadRenderedHashes(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(FIRST_DIAG_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveRenderedHashes(hashes: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FIRST_DIAG_KEY, JSON.stringify([...hashes]));
  } catch {
    // ignore — a full/blocked localStorage must never break telemetry.
  }
}

/**
 * First diagnostic rendered for a cluster. Fired once per cluster per install:
 * the cluster hash is persisted after a real send, so re-hydrating a cached
 * cluster on a later session does not re-count as "first".
 */
export async function trackFirstDiagnosticRendered(clusterId: string): Promise<void> {
  const hash = await clusterHash(clusterId);
  if (hash === null) return;
  const seen = loadRenderedHashes();
  if (seen.has(hash)) return;
  const fired = await capture("rozoom_first_diagnostic_rendered", { cluster_id: hash });
  if (fired) {
    seen.add(hash);
    saveRenderedHashes(seen);
  }
}
