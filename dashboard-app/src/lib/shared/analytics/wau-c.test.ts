import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("posthog-js", () => ({
  default: {
    init: vi.fn(),
    identify: vi.fn(),
    capture: vi.fn(),
  },
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
    const { initAnalytics, posthog, env } = await loadWauC();
    env.PUBLIC_POSTHOG_KEY = "phc_test_key";
    initAnalytics();
    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(vi.mocked(posthog.init).mock.calls[0]?.[0]).toBe("phc_test_key");
  });

  it("stays dark with a key but without consent", async () => {
    const { initAnalytics, posthog, env } = await loadWauC();
    env.PUBLIC_POSTHOG_KEY = "phc_test_key";
    initAnalytics();
    expect(posthog.init).not.toHaveBeenCalled();
  });
});
