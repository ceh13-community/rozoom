import { describe, expect, it } from "vitest";
import { summarizeLogAlerts } from "./log-alerts";

describe("summarizeLogAlerts", () => {
  it("returns empty result for empty logs", () => {
    expect(summarizeLogAlerts("")).toEqual([]);
  });

  it("counts known alert signatures and keeps first line", () => {
    const logs = [
      "normal startup",
      "Warning OOMKilled for container app",
      "probe failed: timeout",
      "CrashLoopBackOff restarting failed container",
      "dial tcp: connection refused",
      "another timeout occurred",
      "OOMKilled happened again",
    ].join("\n");

    expect(summarizeLogAlerts(logs)).toEqual([
      { kind: "oom_killed", label: "OOMKilled", count: 2, firstLine: 2 },
      { kind: "crash_loop_back_off", label: "CrashLoopBackOff", count: 1, firstLine: 4 },
      { kind: "timeout", label: "Timeout", count: 2, firstLine: 3 },
      { kind: "connection_refused", label: "Connection refused", count: 1, firstLine: 5 },
    ]);
  });
});
