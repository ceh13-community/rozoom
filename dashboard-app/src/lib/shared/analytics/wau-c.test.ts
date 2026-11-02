import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("posthog-js", () => ({
  default: {
    init: vi.fn(),
    identify: vi.fn(),
    capture: vi.fn(),
  },
}));

vi.mock("./install-identity", () => ({
  getInstallId: () => "install-1",
  computeAnonymousHash: async (clusterId: string, installId: string) =>
    `hash:${clusterId}:${installId}`,
}));

// wau-c.ts keeps a module-level `initialized` flag, so every test gets a
// fresh copy of the module via resetModules + dynamic import. resetModules
// also re-evaluates the posthog-js and $env mocks, so all three must be
// re-imported together — a stale top-level import would point at the
// pre-reset instances. wau-c reads `env` lazily inside its functions, so
// mutating the returned `env` before calling them is enough.
async function loadWauC() {
  vi.resetModules();
  const wauC = await import("./wau-c");
  const posthog = (await import("posthog-js")).default;
  const { env } = await import("$env/dynamic/public");
  return { ...wauC, posthog, env };
}

function grantConsent(): void {
  window.localStorage.setItem("rozoom.telemetry_consent", "granted");
}

describe("WAU-C stays dark without a PostHog key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("no-ops when PUBLIC_POSTHOG_KEY is absent", async () => {
    grantConsent();
    const { initAnalytics, trackCoreAction, posthog } = await loadWauC();
    initAnalytics();
    await trackCoreAction("rozoom_dashboard_viewed", "cluster-a");
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("no-ops when PUBLIC_POSTHOG_KEY is an empty string", async () => {
    grantConsent();
    const { initAnalytics, trackCoreAction, posthog, env } = await loadWauC();
    env.PUBLIC_POSTHOG_KEY = "";
    initAnalytics();
    await trackCoreAction("rozoom_dashboard_viewed", "cluster-a");
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("no-ops when PUBLIC_POSTHOG_KEY is whitespace only", async () => {
    grantConsent();
    const { initAnalytics, trackCoreAction, posthog, env } = await loadWauC();
    env.PUBLIC_POSTHOG_KEY = "   \t ";
    initAnalytics();
    await trackCoreAction("rozoom_dashboard_viewed", "cluster-a");
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("initialises with a real key and granted consent", async () => {
    grantConsent();
    const { ensureAnalytics, posthog, env } = await loadWauC();
    env.PUBLIC_POSTHOG_KEY = "phc_test_key";
    await expect(ensureAnalytics()).resolves.toBe(true);
    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(vi.mocked(posthog.init).mock.calls[0]?.[0]).toBe("phc_test_key");
  });

  it("boots identified on the install hash and keeps nothing of PostHog's on disk", async () => {
    grantConsent();
    const { ensureAnalytics, PROPERTY_DENYLIST, posthog, env } = await loadWauC();
    env.PUBLIC_POSTHOG_KEY = "phc_test_key";
    await ensureAnalytics();
    const options = vi.mocked(posthog.init).mock.calls[0]?.[1];
    expect(options).toMatchObject({
      persistence: "memory",
      bootstrap: { distinctID: "hash::install-1", isIdentifiedID: true },
      advanced_disable_flags: true,
      ip: false,
      autocapture: false,
      capture_pageview: false,
      disable_session_recording: true,
      person_profiles: "never",
    });
    expect(options?.property_denylist).toBe(PROPERTY_DENYLIST);
    // The screen address, referrers and the SDK's own ids never leave the app.
    expect(PROPERTY_DENYLIST).toEqual(
      expect.arrayContaining([
        "$current_url",
        "$pathname",
        "$referrer",
        "$device_id",
        "$session_id",
      ]),
    );
    expect(posthog.identify).not.toHaveBeenCalled();
  });

  it("strips the person payload posthog-js adds outside the denylist's reach", async () => {
    grantConsent();
    const { ensureAnalytics, stripPersonPayload, posthog, env } = await loadWauC();
    env.PUBLIC_POSTHOG_KEY = "phc_test_key";
    await ensureAnalytics();
    const options = vi.mocked(posthog.init).mock.calls[0]?.[1];
    expect(options?.before_send).toBe(stripPersonPayload);

    const outgoing = stripPersonPayload({
      event: "rozoom_app_opened",
      properties: {
        source: "web",
        $geoip_disable: true,
        first_run: true,
        $initial_current_url: "tauri://localhost/dashboard/clusters/abc",
        $initial_referrer: "$direct",
        $set: { $current_url: "tauri://localhost/dashboard" },
        $set_once: { $initial_pathname: "/dashboard" },
      },
      $set: { $current_url: "tauri://localhost/dashboard/clusters/abc", $os: "Linux" },
      $set_once: { $initial_current_url: "tauri://localhost/dashboard/clusters/abc" },
    });

    expect(outgoing).toEqual({
      event: "rozoom_app_opened",
      properties: { source: "web", $geoip_disable: true, first_run: true },
    });
    expect(stripPersonPayload(null)).toBeNull();
  });

  it("shares one in-flight init between concurrent callers", async () => {
    grantConsent();
    const { ensureAnalytics, posthog, env } = await loadWauC();
    env.PUBLIC_POSTHOG_KEY = "phc_test_key";
    await Promise.all([ensureAnalytics(), ensureAnalytics(), ensureAnalytics()]);
    expect(posthog.init).toHaveBeenCalledTimes(1);
  });

  it("stays dark with a key but without consent", async () => {
    const { ensureAnalytics, posthog, env } = await loadWauC();
    env.PUBLIC_POSTHOG_KEY = "phc_test_key";
    await expect(ensureAnalytics()).resolves.toBe(false);
    expect(posthog.init).not.toHaveBeenCalled();
  });
});
