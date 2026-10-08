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

// wau-c keeps a module-level `initialized` flag, so every test gets a fresh
// copy via resetModules + dynamic import. `env` is read lazily, so mutating
// the returned object before calling into wau-c is enough.
async function loadWauC() {
  vi.resetModules();
  const wauC = await import("./wau-c");
  const posthog = (await import("posthog-js")).default;
  const { env } = await import("$env/dynamic/public");
  env.PUBLIC_POSTHOG_KEY = "phc_test_key";
  return { ...wauC, posthog, env };
}

function grantConsent(): void {
  window.localStorage.setItem("rozoom.telemetry_consent", "granted");
}

describe("activation funnel telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("identifies with an install-level hash and stamps cluster_id on Core Actions", async () => {
    grantConsent();
    const { trackCoreAction, posthog } = await loadWauC();
    await trackCoreAction("rozoom_dashboard_viewed", "cluster-a");
    expect(posthog.identify).toHaveBeenCalledWith("hash::install-1");
    expect(posthog.capture).toHaveBeenCalledWith("rozoom_dashboard_viewed", {
      source: "web",
      cluster_id: "hash:cluster-a:",
    });
  });

  it("app_opened reports first_run=true then false across calls", async () => {
    grantConsent();
    const { trackAppOpened, posthog } = await loadWauC();

    await trackAppOpened();
    expect(posthog.capture).toHaveBeenCalledWith(
      "rozoom_app_opened",
      expect.objectContaining({ first_run: true }),
    );

    await trackAppOpened();
    expect(posthog.capture).toHaveBeenLastCalledWith(
      "rozoom_app_opened",
      expect.objectContaining({ first_run: false }),
    );
  });

  it("app_opened stays dark without consent and does not flip the first-run flag", async () => {
    const { trackAppOpened, posthog } = await loadWauC();
    await trackAppOpened();
    expect(posthog.capture).not.toHaveBeenCalled();

    // Now grant consent: the *first* consented launch must still be first_run=true.
    grantConsent();
    await trackAppOpened();
    expect(posthog.capture).toHaveBeenCalledWith(
      "rozoom_app_opened",
      expect.objectContaining({ first_run: true }),
    );
  });

  it("consent_granted emits once granted", async () => {
    grantConsent();
    const { trackConsentGranted, posthog } = await loadWauC();
    await trackConsentGranted();
    expect(posthog.capture).toHaveBeenCalledWith("rozoom_consent_granted", { source: "web" });
  });

  it("cluster_add_failed emits a bucketed error class, never the raw message", async () => {
    grantConsent();
    const { trackClusterAddFailed, posthog } = await loadWauC();
    await trackClusterAddFailed("cluster-a", "network");
    expect(posthog.capture).toHaveBeenCalledWith("rozoom_cluster_add_failed", {
      source: "web",
      cluster_id: "hash:cluster-a:",
      error_class: "network",
    });
  });

  it("replays pre-consent funnel steps once after consent is granted", async () => {
    const {
      trackClusterAddAttempted,
      trackFirstDiagnosticRendered,
      flushPendingFunnelEvents,
      posthog,
    } = await loadWauC();

    // Fresh install: the prompt only appears after the first scan, so these
    // steps happen while consent is still undecided and stay dark.
    await trackClusterAddAttempted("cluster-a");
    await trackFirstDiagnosticRendered("cluster-a");
    await trackFirstDiagnosticRendered("cluster-a"); // re-render queues once
    expect(posthog.capture).not.toHaveBeenCalled();

    grantConsent();
    await flushPendingFunnelEvents();

    expect(posthog.capture).toHaveBeenCalledTimes(2);
    expect(posthog.capture).toHaveBeenNthCalledWith(1, "rozoom_cluster_add_attempted", {
      source: "web",
      cluster_id: "hash:cluster-a:",
    });
    expect(posthog.capture).toHaveBeenNthCalledWith(2, "rozoom_first_diagnostic_rendered", {
      source: "web",
      cluster_id: "hash:cluster-a:",
    });

    // The queue is one-shot and the first-diagnostic flag is now persisted.
    await flushPendingFunnelEvents();
    await trackFirstDiagnosticRendered("cluster-a");
    expect(posthog.capture).toHaveBeenCalledTimes(2);
  });

  it("does not queue replays once consent is denied", async () => {
    window.localStorage.setItem("rozoom.telemetry_consent", "denied");
    const { trackClusterAddAttempted, flushPendingFunnelEvents, posthog } = await loadWauC();

    await trackClusterAddAttempted("cluster-a");
    // Even if the user later flips to granted (settings), a denied-time step
    // must not resurface.
    grantConsent();
    await flushPendingFunnelEvents();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("first_diagnostic_rendered fires only once per cluster", async () => {
    grantConsent();
    const { trackFirstDiagnosticRendered, posthog } = await loadWauC();

    await trackFirstDiagnosticRendered("cluster-a");
    await trackFirstDiagnosticRendered("cluster-a");
    await trackFirstDiagnosticRendered("cluster-a");

    expect(posthog.capture).toHaveBeenCalledTimes(1);
    expect(posthog.capture).toHaveBeenCalledWith("rozoom_first_diagnostic_rendered", {
      source: "web",
      cluster_id: "hash:cluster-a:",
    });
  });
});
