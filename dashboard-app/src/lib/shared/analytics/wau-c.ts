import posthog from "posthog-js";
import { env } from "$env/dynamic/public";
import { getInstallId, getInstallHash, computeAnonymousHash } from "./install-identity";
import { getTelemetryConsent, isDoNotTrack, isTelemetryEnabled } from "./consent";

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
 * privacy-first. Identity is a pseudonymous install-hash = SHA-256(install_id),
 * bootstrapped as the identified distinct_id so the SDK never mints an
 * anonymous id and never emits $identify. Telemetry is strictly opt-in (U_DAW
 * decision 2026-06-10): nothing is initialised or sent until the user grants
 * consent — see ./consent and ./telemetry-consent.
 *
 * Data minimisation (PM decision 2026-11-02, release 0.26.0): PostHog keeps
 * nothing on disk (memory persistence), the library's URL/referrer/device/session
 * properties are dropped before sending, no feature-flag request is made, and
 * every event asks the server to skip GeoIP enrichment.
 */
export type CoreAction =
  | "rozoom_dashboard_viewed"
  | "rozoom_workload_detail_opened"
  | "rozoom_resource_action_taken";

/** Bucketed connect-failure class, never the raw error (which may contain URLs). */
type ConnectErrorClass = "auth" | "network" | "tls" | "unknown";

let initialized = false;
let initInFlight: Promise<boolean> | null = null;

/**
 * Properties posthog-js attaches on its own that have no place in our telemetry:
 * the app's internal screen address (the route carries the cluster uuid), referrers,
 * and the library's own device/session/window ids. Dropped client-side, never sent.
 */
export const PROPERTY_DENYLIST = [
  "$current_url",
  "$pathname",
  "$host",
  "$referrer",
  "$referring_domain",
  "$session_entry_url",
  "$session_entry_pathname",
  "$session_entry_host",
  "$session_entry_referrer",
  "$session_entry_referring_domain",
  "$device_id",
  "$session_id",
  "$window_id",
];

/**
 * Stamped on every event. `source` marks the app; `$geoip_disable` tells PostHog's
 * ingestion to skip GeoIP enrichment, so no country/city/coordinates are derived
 * from the connection (verified against the EU project on 2026-11-02).
 */
const BASE_EVENT_PROPS = { source: "web", $geoip_disable: true } as const;

/** The shape posthog-js hands to `before_send`: the event name plus the payload blocks we care about. */
type OutgoingEvent = {
  event: string;
  properties?: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
} | null;

/**
 * Last hook before the wire. For an identified person posthog-js attaches person
 * payload outside `properties`: `$set` (current URL, host, path, referrer) and, once
 * per session, `$set_once` with the `$initial_*` versions of the same. `property_denylist`
 * never sees those blocks, so they are stripped here, together with any `$initial_*`
 * key that may still sit in `properties`. The event itself is kept.
 */
export function stripPersonPayload<T extends OutgoingEvent>(event: T): T {
  if (!event) return event;
  delete event.$set;
  delete event.$set_once;
  if (event.properties) {
    event.properties = Object.fromEntries(
      Object.entries(event.properties).filter(
        ([key]) => key !== "$set" && key !== "$set_once" && !key.startsWith("$initial_"),
      ),
    );
  }
  return event;
}

/**
 * Kick off initialisation without waiting for it. Safe to call on every app mount
 * and again right after consent is granted; see ensureAnalytics for the rules.
 */
export function initAnalytics(): void {
  void ensureAnalytics();
}

/**
 * Initialise PostHog once, only when the user has granted consent and a project
 * key is configured. Resolves true when the SDK is ready to capture. Idempotent:
 * concurrent callers share one in-flight init, later callers return at once.
 * Never throws into the caller.
 */
export async function ensureAnalytics(): Promise<boolean> {
  if (initialized) return true;
  if (typeof window === "undefined") return false;

  const key = env.PUBLIC_POSTHOG_KEY?.trim();
  if (!key) return false; // No key configured (e.g. local dev without telemetry) — stay dark.
  if (!isTelemetryEnabled()) return false;

  initInFlight ??= (async () => {
    try {
      // SHA-256(install_id), the same function Fleet Settings shows the user.
      const distinctId = await getInstallHash();
      if (!distinctId) throw new Error("install id unavailable");
      posthog.init(key, {
        api_host: env.PUBLIC_POSTHOG_HOST?.trim() || "https://eu.i.posthog.com",
        // Start already identified on the install hash: no anonymous id, no
        // $identify/merge per session, one person per install from the first event.
        bootstrap: { distinctID: distinctId, isIdentifiedID: true },
        // PostHog keeps nothing in localStorage or cookies; our own install id
        // and consent flags live under rozoom.* keys and are not the SDK's.
        persistence: "memory",
        property_denylist: PROPERTY_DENYLIST,
        // Person payload ($set/$set_once with the first and current URL) bypasses the
        // denylist; drop it on the way out.
        before_send: stripPersonPayload,
        // We define no feature flags, so never call /flags (also skips remote config).
        advanced_disable_flags: true,
        // Ask the server not to record the client IP; the EU project discards it anyway.
        ip: false,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        // No person profiles at all (PM decision 2026-11-02): events still carry the
        // install hash as distinct_id, so unique installs count the same, but PostHog
        // creates no person record (nothing without an expiry) and, with person
        // processing off, never builds the $set/$set_once blocks in the first place.
        person_profiles: "never",
      });
      initialized = true;
    } catch {
      // Telemetry must never break the app. Swallow and stay uninitialised.
      initialized = false;
    } finally {
      initInFlight = null;
    }
    return initialized;
  })();
  return initInFlight;
}

/**
 * Cluster identity: SHA-256(cluster_id + install_id), exactly as install-identity.ts
 * documents. The install id is the salt: the same cluster hashes differently on every
 * install, so a short common name ("prod", "minikube") cannot be looked up across
 * installs. Releases before 0.26.0 hashed the identifier alone; see legacyClusterHash.
 */
async function clusterHash(clusterId: string): Promise<string | null> {
  try {
    return await computeAnonymousHash(clusterId, getInstallId());
  } catch {
    // crypto.subtle unavailable — stay dark rather than send a malformed event.
    return null;
  }
}

/**
 * The unsalted hash used by releases before 0.26.0. Never sent anywhere: kept only to
 * recognise clusters an upgraded install already recorded in localStorage under the
 * old scheme, so the upgrade does not re-fire one-shot events.
 */
async function legacyClusterHash(clusterId: string): Promise<string | null> {
  try {
    return await computeAnonymousHash(clusterId, "");
  } catch {
    return null;
  }
}

/**
 * Internal capture: lazy init + consent re-check + capture.
 * Returns true only when an event was actually emitted, so one-shot
 * bookkeeping (first-run flag, first-diagnostic flag) can be gated on a
 * real send rather than a no-op attempt made before consent was granted.
 */
async function capture(event: string, props: Record<string, unknown> = {}): Promise<boolean> {
  // Lazy init: child onMount runs before the root layout's in Svelte, so a
  // deep launch straight into a cluster route would otherwise emit before
  // initAnalytics() ever ran. Idempotent and consent-gated, so safe here.
  if (!(await ensureAnalytics())) return false;
  // Re-check consent on every emit so a withdrawal after init takes effect
  // immediately, not on the next reload.
  if (!isTelemetryEnabled()) return false;
  try {
    // Identity is bootstrapped at init, so no identify() call and no $identify event.
    posthog.capture(event, { ...BASE_EVENT_PROPS, ...props });
    return true;
  } catch {
    // Best-effort. A failed metric must never surface to the user.
    return false;
  }
}

/**
 * Emit a Core Action. Resolves the pseudonymous identity lazily so we never block
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

// ── Pre-consent replay ──────────────────────────────────────────────
// The consent prompt appears only after the first scan (Sprint 24 item 7),
// so on a fresh install the cluster-add and first-diagnostic steps happen
// *before* the user can grant consent and capture() no-ops them. These steps
// never re-occur in the session, so without a replay the calibration metric
// first_diagnostic/cluster_add would read 0:0 on every clean install. Keep
// them in-memory (keyed, so repeated renders queue once) and flush right
// after "Allow". Deliberately not persisted: a user who declines or quits
// undecided leaves nothing behind.
const pendingReplays = new Map<string, () => Promise<void>>();

function rememberPending(key: string, replay: () => Promise<void>): void {
  if (isDoNotTrack() || getTelemetryConsent() !== "undecided") return;
  if (!pendingReplays.has(key)) pendingReplays.set(key, replay);
}

/** Re-emit funnel steps that happened before consent was granted. */
export async function flushPendingFunnelEvents(): Promise<void> {
  const replays = [...pendingReplays.values()];
  pendingReplays.clear();
  for (const replay of replays) await replay();
}

/** A cluster add (kubeconfig import / paste / selection) was attempted. */
export async function trackClusterAddAttempted(clusterId: string): Promise<void> {
  const hash = await clusterHash(clusterId);
  if (hash === null) return;
  const fired = await capture("rozoom_cluster_add_attempted", { cluster_id: hash });
  if (!fired) {
    rememberPending(`add:${hash}`, () => trackClusterAddAttempted(clusterId));
  }
}

/** A cluster add failed; `errorClass` is a bucket, never the raw message. */
export async function trackClusterAddFailed(
  clusterId: string,
  errorClass: ConnectErrorClass,
): Promise<void> {
  const hash = await clusterHash(clusterId);
  if (hash === null) return;
  const fired = await capture("rozoom_cluster_add_failed", {
    cluster_id: hash,
    error_class: errorClass,
  });
  if (!fired) {
    rememberPending(`add-failed:${hash}`, () => trackClusterAddFailed(clusterId, errorClass));
  }
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
  // An install upgraded from a release before 0.26.0 remembers this cluster under the
  // unsalted hash. Count it as seen and move the record to the salted hash, otherwise
  // every known cluster would report a second "first diagnostic" right after the upgrade.
  const legacy = await legacyClusterHash(clusterId);
  if (legacy !== null && seen.has(legacy)) {
    seen.delete(legacy);
    seen.add(hash);
    saveRenderedHashes(seen);
    return;
  }
  const fired = await capture("rozoom_first_diagnostic_rendered", { cluster_id: hash });
  if (fired) {
    seen.add(hash);
    saveRenderedHashes(seen);
  } else {
    rememberPending(`first-diag:${hash}`, () => trackFirstDiagnosticRendered(clusterId));
  }
}
