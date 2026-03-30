import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSerialRefresh } from "./serial-refresh";

describe("createSerialRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not run refresh in parallel and schedules one forced rerun", async () => {
    const run = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => resolve(), 50);
        }),
    );

    const serial = createSerialRefresh(run);

    const first = serial.trigger();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);

    await serial.trigger();
    await serial.trigger({ force: true });
    await serial.trigger({ force: true });
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60);
    await first;
    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledTimes(2);
    });
  });

  it("passes options to the first run", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const serial = createSerialRefresh(run);

    await serial.trigger({ force: true });

    expect(run).toHaveBeenCalledWith({ force: true });
  });
});
