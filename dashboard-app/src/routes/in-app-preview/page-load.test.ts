import { describe, expect, it } from "vitest";
import { load } from "./+page";

describe("in-app-preview page load", () => {
  it("keeps only http/https preview target", async () => {
    const allowed = (await load({
      url: new URL("http://localhost/in-app-preview?url=https%3A%2F%2Fexample.com"),
    } as Parameters<typeof load>[0])) as { targetUrl: string; redirectMode: boolean };
    const blocked = (await load({
      url: new URL("http://localhost/in-app-preview?url=javascript%3Aalert(1)"),
    } as Parameters<typeof load>[0])) as { targetUrl: string; redirectMode: boolean };
    const redirect = (await load({
      url: new URL("http://localhost/in-app-preview?url=https%3A%2F%2Fexample.com&redirect=1"),
    } as Parameters<typeof load>[0])) as { targetUrl: string; redirectMode: boolean };

    expect(allowed.targetUrl).toBe("https://example.com/");
    expect(allowed.redirectMode).toBe(false);
    expect(blocked.targetUrl).toBe("about:blank");
    expect(redirect.redirectMode).toBe(true);
  });
});
