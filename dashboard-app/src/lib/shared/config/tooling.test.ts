import { afterEach, describe, expect, it, vi } from "vitest";

const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)";
const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

function stubPlatform(ua: string) {
  vi.stubGlobal("navigator", { userAgent: ua });
}

describe("isToolBundled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("full build on Linux: bundled tools true, planned gcloud false", async () => {
    stubPlatform(LINUX_UA);
    const { isToolBundled } = await import("./tooling");
    expect(isToolBundled("kubectl")).toBe(true);
    expect(isToolBundled("helm")).toBe(true);
    expect(isToolBundled("aws")).toBe(true);
    expect(isToolBundled("az")).toBe(true);
    expect(isToolBundled("doctl")).toBe(true);
    expect(isToolBundled("gcloud")).toBe(false);
  });

  it("slim build: only kubectl and helm are bundled", async () => {
    vi.stubEnv("VITE_ROZOOM_TOOLS", "kubectl,helm");
    stubPlatform(LINUX_UA);
    const { isToolBundled } = await import("./tooling");
    expect(isToolBundled("kubectl")).toBe(true);
    expect(isToolBundled("helm")).toBe(true);
    expect(isToolBundled("aws")).toBe(false);
    expect(isToolBundled("az")).toBe(false);
    expect(isToolBundled("doctl")).toBe(false);
    expect(isToolBundled("gcloud")).toBe(false);
  });

  it("macOS full build: aws and az are stubs, doctl still ships", async () => {
    stubPlatform(MAC_UA);
    const { isToolBundled } = await import("./tooling");
    expect(isToolBundled("aws")).toBe(false);
    expect(isToolBundled("az")).toBe(false);
    expect(isToolBundled("doctl")).toBe(true);
    expect(isToolBundled("gcloud")).toBe(false);
  });
});
