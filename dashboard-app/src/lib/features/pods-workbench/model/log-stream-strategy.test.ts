import { describe, expect, it, vi } from "vitest";
import { openStreamWithOptionalFallback } from "./log-stream-strategy";

describe("openStreamWithOptionalFallback", () => {
  it("returns primary stream result when it succeeds", async () => {
    const primary = vi.fn().mockResolvedValue("primary");
    const fallback = vi.fn().mockResolvedValue("fallback");

    await expect(openStreamWithOptionalFallback(primary, fallback)).resolves.toBe("primary");
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("uses fallback when primary fails", async () => {
    const primary = vi.fn().mockRejectedValue(new Error("primary failed"));
    const fallback = vi.fn().mockResolvedValue("fallback");

    await expect(openStreamWithOptionalFallback(primary, fallback)).resolves.toBe("fallback");
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("rethrows primary error when fallback is not provided", async () => {
    const error = new Error("primary failed");
    const primary = vi.fn().mockRejectedValue(error);

    await expect(openStreamWithOptionalFallback(primary)).rejects.toThrow("primary failed");
  });
});
