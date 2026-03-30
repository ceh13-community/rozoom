import { describe, expect, it } from "vitest";
import { createPodsRefreshGuard } from "./pods-refresh-guard";

describe("pods-refresh-guard", () => {
  it("enters cooldown on transient connectivity errors", () => {
    const guard = createPodsRefreshGuard();
    const now = 1_000;
    const applied = guard.applyError("Unable to connect to the server: i/o timeout", now);
    expect(applied.backoffMs).toBe(8_000);
    expect(guard.isCoolingDown(now + 100)).toBe(true);
    expect(guard.getRemainingCooldownMs(now + 100)).toBe(7_900);
  });

  it("escalates cooldown with error streak and caps it", () => {
    const guard = createPodsRefreshGuard();
    const now = 2_000;
    let last = guard.applyError("Metrics API not available", now);
    expect(last.backoffMs).toBe(20_000);
    last = guard.applyError("Metrics API not available", now + 10);
    expect(last.backoffMs).toBe(40_000);
    last = guard.applyError("Metrics API not available", now + 20);
    expect(last.backoffMs).toBe(80_000);
    last = guard.applyError("Metrics API not available", now + 30);
    expect(last.backoffMs).toBe(90_000);
  });

  it("resets state after successful refresh", () => {
    const guard = createPodsRefreshGuard();
    const now = 3_000;
    guard.applyError("context deadline exceeded", now);
    guard.reset();
    expect(guard.isCoolingDown(now + 1)).toBe(false);
    expect(guard.getRemainingCooldownMs(now + 1)).toBe(0);
  });
});
