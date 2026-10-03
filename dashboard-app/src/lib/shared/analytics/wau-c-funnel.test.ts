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
