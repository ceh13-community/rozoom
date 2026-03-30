import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
}));

vi.mock("@/lib/shared/api/kubectl-proxy", () => ({
  kubectlRawFront: vi.fn(),
}));

import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { checkWarningEvents } from "./check-warning-events";

const mockedKubectl = vi.mocked(kubectlRawFront);

function makeEventList(events: unknown[]) {
  return JSON.stringify({ items: events });
}

function makeWarningEvent(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    type: "Warning",
    reason: "BackOff",
    message: "Back-off pulling image",
    count: 1,
    lastTimestamp: now,
    metadata: { namespace: "default", creationTimestamp: now },
    involvedObject: { kind: "Pod", name: "my-pod" },
    ...overrides,
  };
}

describe("checkWarningEvents", () => {
  const clusterId = "cluster-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok when no warning events", async () => {
    mockedKubectl.mockResolvedValue({
      output: makeEventList([]),
      errors: "",
      code: 0,
    });

    const result = await checkWarningEvents(clusterId, { force: true });

    expect(result.status).toBe("ok");
    expect(result.items).toHaveLength(0);
  });

  it("returns ok when few recent warning events (below threshold)", async () => {
    const events = Array.from({ length: 3 }, () => makeWarningEvent());
    mockedKubectl.mockResolvedValue({
      output: makeEventList(events),
      errors: "",
      code: 0,
    });

    const result = await checkWarningEvents(clusterId, { force: true });

    expect(result.status).toBe("ok");
    expect(result.items).toHaveLength(3);
  });

  it("returns warning when events exceed warning threshold", async () => {
    const events = Array.from({ length: 6 }, (_, i) => makeWarningEvent({ reason: `Reason${i}` }));
    mockedKubectl.mockResolvedValue({
      output: makeEventList(events),
      errors: "",
      code: 0,
    });

    const result = await checkWarningEvents(clusterId, { force: true });

    expect(result.status).toBe("warning");
  });

  it("returns critical when events exceed critical threshold", async () => {
    const events = Array.from({ length: 16 }, (_, i) => makeWarningEvent({ reason: `Reason${i}` }));
    mockedKubectl.mockResolvedValue({
      output: makeEventList(events),
      errors: "",
      code: 0,
    });

    const result = await checkWarningEvents(clusterId, { force: true });

    expect(result.status).toBe("critical");
  });

  it("returns critical when NodeNotReady event detected", async () => {
    const events = [
      makeWarningEvent({
        reason: "NotReady",
        involvedObject: { kind: "Node", name: "worker-1" },
      }),
    ];
    mockedKubectl.mockResolvedValue({
      output: makeEventList(events),
      errors: "",
      code: 0,
    });

    const result = await checkWarningEvents(clusterId, { force: true });

    expect(result.status).toBe("critical");
  });

  it("returns unknown on kubectl error", async () => {
    mockedKubectl.mockResolvedValue({
      output: "",
      errors: "connection refused",
      code: 1,
    });

    const result = await checkWarningEvents(clusterId, { force: true });

    expect(result.status).toBe("unknown");
    expect(result.errors).toBeDefined();
  });

  it("returns unknown on thrown error", async () => {
    mockedKubectl.mockRejectedValue(new Error("network failure"));

    const result = await checkWarningEvents(clusterId, { force: true });

    expect(result.status).toBe("unknown");
    expect(result.errors).toBeDefined();
  });

  it("handles empty output gracefully", async () => {
    mockedKubectl.mockResolvedValue({
      output: "",
      errors: "",
      code: 0,
    });

    const result = await checkWarningEvents(clusterId, { force: true });

    expect(result.status).toBe("ok");
    expect(result.items).toHaveLength(0);
  });

  it("filters out old events beyond retention window", async () => {
    const oldTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const events = [makeWarningEvent({ lastTimestamp: oldTimestamp })];
    mockedKubectl.mockResolvedValue({
      output: makeEventList(events),
      errors: "",
      code: 0,
    });

    const result = await checkWarningEvents(clusterId, { force: true });

    expect(result.status).toBe("ok");
    expect(result.items).toHaveLength(0);
  });

  it("includes summary message with top reasons", async () => {
    const events = Array.from({ length: 6 }, () =>
      makeWarningEvent({ reason: "CrashLoopBackOff" }),
    );
    mockedKubectl.mockResolvedValue({
      output: makeEventList(events),
      errors: "",
      code: 0,
    });

    const result = await checkWarningEvents(clusterId, { force: true });

    expect(result.summary.message).toContain("CrashLoopBackOff");
  });
});
