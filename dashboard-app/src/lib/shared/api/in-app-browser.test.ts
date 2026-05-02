import { beforeEach, describe, expect, it, vi } from "vitest";

const webviewCtor = vi.hoisted(() => vi.fn());
const openUrlMock = vi.hoisted(() => vi.fn());
const onceMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    constructor(label: string, options: Record<string, unknown>) {
      webviewCtor(label, options);
    }
    once = onceMock;
  },
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: openUrlMock,
}));

describe("in-app-browser", () => {
  beforeEach(() => {
    webviewCtor.mockReset();
    openUrlMock.mockReset();
    onceMock.mockReset();
  });

  it("opens in-app preview route with redirect mode", async () => {
    const { openInAppUrl } = await import("./in-app-browser");
    await openInAppUrl("http://127.0.0.1:8080");

    expect(webviewCtor).toHaveBeenCalledTimes(1);
    const [, options] = webviewCtor.mock.calls[0];
    const openedUrl = String((options as { url?: string }).url ?? "");
    expect(openedUrl).toContain("/in-app-preview?");
    expect(openedUrl).toContain("url=http%3A%2F%2F127.0.0.1%3A8080");
    expect(openedUrl).toContain("redirect=1");
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  it("falls back to opening in-app preview route in browser when webview api is unavailable", async () => {
    vi.resetModules();
    vi.doMock("@tauri-apps/api/webviewWindow", () => {
      throw new Error("missing tauri runtime");
    });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    const { openInAppUrl } = await import("./in-app-browser");
    await openInAppUrl("http://127.0.0.1:8080");

    expect(openSpy).toHaveBeenCalledTimes(1);
    const [openedUrl] = openSpy.mock.calls[0];
    expect(String(openedUrl)).toContain("/in-app-preview?");
    expect(String(openedUrl)).toContain("url=http%3A%2F%2F127.0.0.1%3A8080");
    expect(String(openedUrl)).toContain("redirect=1");
    expect(openUrlMock).not.toHaveBeenCalled();

    openSpy.mockRestore();
    vi.resetModules();
  });

  describe("isLoopbackUrl", () => {
    it("accepts standard loopback targets", async () => {
      const { isLoopbackUrl } = await import("./in-app-browser");
      expect(isLoopbackUrl("https://localhost:18080")).toBe(true);
      expect(isLoopbackUrl("http://127.0.0.1:3000/ui")).toBe(true);
      expect(isLoopbackUrl("https://[::1]:443")).toBe(true);
      expect(isLoopbackUrl("http://localhost")).toBe(true);
    });

    it("rejects public, private, and non-http schemes", async () => {
      const { isLoopbackUrl } = await import("./in-app-browser");
      expect(isLoopbackUrl("https://example.com")).toBe(false);
      expect(isLoopbackUrl("https://evil.com/localhost")).toBe(false);
      expect(isLoopbackUrl("https://192.168.1.10:9000")).toBe(false);
      expect(isLoopbackUrl("https://10.0.0.1")).toBe(false);
      expect(isLoopbackUrl("https://127.0.0.2")).toBe(false);
      expect(isLoopbackUrl("file:///etc/passwd")).toBe(false);
      expect(isLoopbackUrl("")).toBe(false);
      expect(isLoopbackUrl("not a url")).toBe(false);
    });

    it("is not fooled by URL tricks that encode loopback in the path or credentials", async () => {
      const { isLoopbackUrl } = await import("./in-app-browser");
      expect(isLoopbackUrl("https://evil.com/127.0.0.1")).toBe(false);
      expect(isLoopbackUrl("https://evil.com#@localhost")).toBe(false);
      expect(isLoopbackUrl("https://localhost@evil.com")).toBe(false);
      expect(isLoopbackUrl("https://127.0.0.1.evil.com")).toBe(false);
    });
  });
});
