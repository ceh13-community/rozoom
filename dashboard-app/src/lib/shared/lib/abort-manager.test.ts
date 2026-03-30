import { describe, expect, it } from "vitest";
import { createAbortManager } from "./abort-manager";

describe("abort-manager", () => {
  it("aborts previous signal for the same key", () => {
    const manager = createAbortManager();
    const first = manager.nextSignal("details");
    const second = manager.nextSignal("details");
    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
    expect(manager.isLatest("details", second)).toBe(true);
  });

  it("aborts all active signals", () => {
    const manager = createAbortManager();
    const details = manager.nextSignal("details");
    const logs = manager.nextSignal("logs");
    manager.abortAll();
    expect(details.aborted).toBe(true);
    expect(logs.aborted).toBe(true);
  });
});
