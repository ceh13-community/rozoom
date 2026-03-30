import { describe, expect, it, vi } from "vitest";

vi.mock("./request-scheduler", () => ({
  workloadRequestScheduler: {
    getQueuedCount: vi.fn(),
    getActiveCount: vi.fn(),
  },
}));

import { workloadRequestScheduler } from "./request-scheduler";
import { computeAdaptivePollingSeconds } from "./adaptive-polling";

describe("computeAdaptivePollingSeconds", () => {
  it("increases interval under queue pressure", () => {
    vi.mocked(workloadRequestScheduler.getQueuedCount).mockReturnValue(8);
    vi.mocked(workloadRequestScheduler.getActiveCount).mockReturnValue(5);
    expect(computeAdaptivePollingSeconds(10, { isVisible: true })).toBeGreaterThan(10);
  });

  it("decreases interval when there was a recent mutation", () => {
    vi.mocked(workloadRequestScheduler.getQueuedCount).mockReturnValue(0);
    vi.mocked(workloadRequestScheduler.getActiveCount).mockReturnValue(0);
    expect(
      computeAdaptivePollingSeconds(20, { hasRecentMutation: true, isVisible: true }),
    ).toBeLessThan(20);
  });

  it("applies error backoff and interactive burst modifiers", () => {
    vi.mocked(workloadRequestScheduler.getQueuedCount).mockReturnValue(0);
    vi.mocked(workloadRequestScheduler.getActiveCount).mockReturnValue(0);
    const now = 1_000_000;
    const backedOff = computeAdaptivePollingSeconds(20, { errorStreak: 3, isVisible: true, now });
    const burst = computeAdaptivePollingSeconds(20, {
      burstUntil: now + 5_000,
      isVisible: true,
      now,
    });
    expect(backedOff).toBeGreaterThan(20);
    expect(burst).toBeLessThan(20);
  });
});
