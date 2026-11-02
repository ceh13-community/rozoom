import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real posthog-js, real wire: this is the one test that looks at what actually
// leaves the app, not at what we passed to a mocked SDK.
vi.mock("./install-identity", () => ({
  getInstallId: () => "install-1",
  computeAnonymousHash: async (clusterId: string, installId: string) =>
    `hash:${clusterId}:${installId}`,
}));

type Sent = { url: string; body: unknown };
const sent: Sent[] = [];

async function decodeBody(body: unknown): Promise<unknown> {
  let bytes: Buffer | null = null;
  // Blob/File may come from jsdom's realm, so duck-type instead of instanceof.
  const blobLike = body as { arrayBuffer?: () => Promise<ArrayBuffer> } | null;
  if (blobLike && typeof blobLike.arrayBuffer === "function") {
    bytes = Buffer.from(await blobLike.arrayBuffer());
  } else if (body instanceof ArrayBuffer) bytes = Buffer.from(body);
  else if (ArrayBuffer.isView(body))
    bytes = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  else if (typeof body === "string") {
    if (body.startsWith("data=")) {
      const raw = decodeURIComponent(body.slice("data=".length));
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as unknown;
      }
    }
    return JSON.parse(body) as unknown;
  }
  if (!bytes) {
    const ctor =
      (body as { constructor?: { name?: string } } | null)?.constructor?.name ?? typeof body;
    throw new Error(`unexpected body type ${ctor}`);
  }
  // gzip magic bytes 1f 8b, otherwise plain JSON bytes
  const text =
    bytes[0] === 0x1f && bytes[1] === 0x8b
      ? gunzipSync(bytes).toString("utf8")
      : bytes.toString("utf8");
  return JSON.parse(text) as unknown;
}

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
    prefix + k,
    ...flattenKeys(v, `${prefix}${k}.`),
  ]);
}

describe("WAU-C on the wire (real posthog-js)", () => {
  beforeEach(() => {
    sent.length = 0;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("rozoom.telemetry_consent", "granted");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        sent.push({ url: String(url), body: init?.body });
        return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends only the event, our properties and the SDK's technical ones; no URL, ids or person payload; nothing on disk", async () => {
    vi.resetModules();
    const { env } = await import("$env/dynamic/public");
    env.PUBLIC_POSTHOG_KEY = "phc_wire_test";
    env.PUBLIC_POSTHOG_HOST = "https://eu.i.posthog.com";
    const wauC = await import("./wau-c");

    await wauC.trackCoreAction("rozoom_dashboard_viewed", "prod");
    // Batched requests flush on a timer; compression (CompressionStream) is async.
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(1_000);

    const eventRequests = sent.filter(
      (s) => /\/(e|batch)\/?\?/.test(s.url) || /\/(e|batch)\/?$/.test(s.url),
    );
    expect(eventRequests.length).toBeGreaterThan(0);
    // No /flags or /decide call at all.
    expect(sent.some((s) => /\/(flags|decide)\//.test(s.url))).toBe(false);
    // The client asks the server not to record the IP.
    expect(eventRequests[0]?.url).toMatch(/[?&]ip=0(&|$)/);

    const decoded = await decodeBody(eventRequests[0]?.body);
    const events = (Array.isArray(decoded) ? decoded : [decoded]) as Record<string, unknown>[];
    const ours = events.find((e) => e.event === "rozoom_dashboard_viewed");
    expect(ours).toBeDefined();
    const props = ours?.properties as Record<string, unknown>;

    expect(props.distinct_id ?? ours?.distinct_id).toBe("hash::install-1");
    expect(props.$geoip_disable).toBe(true);
    expect(props.source).toBe("web");
    expect(props.cluster_id).toBe("hash:prod:install-1");
    expect(props.$lib).toBe("web"); // the SDK's own technical properties still travel
    // No person profiles: the server is told not to process a person for this event.
    expect(props.$process_person_profile).toBe(false);

    const keys = flattenKeys(ours);
    const forbidden = keys.filter(
      (k) =>
        /(^|\.)\$(set|set_once)(\.|$)/.test(k) ||
        /\$initial_/.test(k) ||
        /(^|\.)\$(current_url|pathname|host|referrer|referring_domain|device_id|session_id|window_id)$/.test(
          k,
        ) ||
        /\$session_entry_/.test(k),
    );
    expect(forbidden).toEqual([]);

    // Memory persistence: the SDK leaves nothing of its own behind.
    const stored = [
      ...Object.keys(window.localStorage),
      ...Object.keys(window.sessionStorage),
      ...document.cookie.split(";").map((c) => c.trim().split("=")[0] ?? ""),
    ].filter((k) => k.startsWith("ph_"));
    expect(stored).toEqual([]);
  });
});
