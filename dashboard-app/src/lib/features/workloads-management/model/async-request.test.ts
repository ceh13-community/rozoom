import { describe, expect, it, vi } from "vitest";
import { debounce, withAbortableLatestOnly } from "./async-request";

describe("async-request", () => {
  it("aborts previous request when starting a new one", async () => {
    const ref = { current: null as AbortController | null };
    const first = withAbortableLatestOnly(
      async (signal) =>
        await new Promise<boolean>((resolve) => {
          signal.addEventListener("abort", () => resolve(true));
        }),
      ref,
    );

    await withAbortableLatestOnly(async () => "second", ref);
    await expect(first).resolves.toBe(true);
  });

  it("debounces function calls", async () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const run = debounce(spy, 50);
    run("a");
    run("b");
    vi.advanceTimersByTime(60);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("b");
    vi.useRealTimers();
  });
});
