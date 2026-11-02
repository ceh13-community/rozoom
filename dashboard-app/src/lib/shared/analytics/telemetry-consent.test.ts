import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("svelte-sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn() },
}));
vi.mock("./consent", () => ({
  needsConsentPrompt: vi.fn(() => true),
  setTelemetryConsent: vi.fn(),
}));
vi.mock("./wau-c", () => ({
  flushPendingFunnelEvents: vi.fn(async () => {}),
  initAnalytics: vi.fn(),
  trackAppOpened: vi.fn(async () => {}),
  trackConsentGranted: vi.fn(async () => {}),
}));

// The module remembers that it already prompted this session, so every test
// loads a fresh copy via resetModules + dynamic import.
async function load() {
  vi.resetModules();
  const prompt = await import("./telemetry-consent");
  const { toast } = await import("svelte-sonner");
  const { env } = await import("$env/dynamic/public");
  const Description = (await import("./telemetry-consent-description.svelte")).default;
  return { prompt, toast, env, Description };
}

describe("telemetry consent prompt copy (mM8lRQ78)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the title and puts the EU description component with the privacy link under it", async () => {
    const { prompt, toast, env, Description } = await load();
    env.PUBLIC_POSTHOG_KEY = "phc_test_key";

    prompt.maybePromptTelemetryConsent();

    expect(toast.info).toHaveBeenCalledTimes(1);
    const [title, options] = vi.mocked(toast.info).mock.calls[0] ?? [];
    expect(title).toBe("Help improve Rozoom?");
    expect(options?.description).toBe(Description);
    expect(options?.duration).toBe(Number.POSITIVE_INFINITY);
    expect(options?.action?.label).toBe("Allow");
    expect(options?.cancel?.label).toBe("No thanks");
  });

  it("still stays silent without a PostHog key", async () => {
    const { prompt, toast, env } = await load();
    env.PUBLIC_POSTHOG_KEY = "";

    prompt.maybePromptTelemetryConsent();

    expect(toast.info).not.toHaveBeenCalled();
  });
});
