import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock $app/environment before importing theme
vi.mock("$app/environment", () => ({ browser: false }));

describe("theme store", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should default to dark when not in browser", async () => {
    const { theme } = await import("./theme");
    let value: string | undefined;
    theme.subscribe((v) => (value = v))();
    expect(value).toBe("dark");
  });

  it("should cycle through themes in order", async () => {
    const { theme } = await import("./theme");
    const values: string[] = [];

    const unsub = theme.subscribe((v) => values.push(v));

    theme.cycle(); // dark -> k9s
    theme.cycle(); // k9s -> light
    theme.cycle(); // light -> dark

    unsub();
    expect(values).toEqual(["dark", "k9s", "light", "dark"]);
  });

  it("should accept valid theme via set", async () => {
    const { theme } = await import("./theme");
    let value: string | undefined;

    theme.set("k9s");
    theme.subscribe((v) => (value = v))();
    expect(value).toBe("k9s");
  });
});
