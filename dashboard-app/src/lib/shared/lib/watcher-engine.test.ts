import { describe, expect, it, vi } from "vitest";

vi.mock("./adaptive-polling", () => ({
  computeAdaptivePollingSeconds: vi.fn(() => 1),
}));

import { createWatcherEngine } from "./watcher-engine";

describe("watcher-engine", () => {
  it("runs immediate tick and reschedules", async () => {
    vi.useFakeTimers();
    const onTick = vi.fn(async () => {});
    const engine = createWatcherEngine({
      isEnabled: () => true,
      getRefreshSeconds: () => 30,
      onTick,
    });

    engine.start(true);
    await vi.runOnlyPendingTimersAsync();
    expect(onTick).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("skips ticks when not visible", async () => {
    const onTick = vi.fn(async () => {});
    const engine = createWatcherEngine({
      isEnabled: () => true,
      isVisible: () => false,
      getRefreshSeconds: () => 30,
      onTick,
    });
    engine.trigger();
    await Promise.resolve();
    expect(onTick).not.toHaveBeenCalled();
  });
});
