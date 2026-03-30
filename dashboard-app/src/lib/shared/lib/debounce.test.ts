import { describe, expect, it, vi } from "vitest";
import { debounce } from "./debounce";

describe("debounce", () => {
  it("calls function once with latest args", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const wrapped = debounce(fn, 50);

    wrapped("a");
    wrapped("b");
    wrapped("c");
    vi.advanceTimersByTime(49);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("c");
    vi.useRealTimers();
  });
});
