import { describe, expect, it } from "vitest";
import { buildIncidentTimeline } from "./incident-timeline";

describe("incident-timeline", () => {
  it("combines multiple signal types chronologically", () => {
    const result = buildIncidentTimeline({
      podRestarts: [
        {
          podName: "web-1",
          namespace: "prod",
          containerName: "app",
          restartCount: 1,
          reason: "OOMKilled",
          timestamp: "2026-03-21T10:02:00Z",
        },
      ],
      alerts: [
        {
          name: "HighMemory",
          namespace: "prod",
          severity: "warning",
          status: "firing",
          startsAt: "2026-03-21T10:00:00Z",
          message: "Memory > 90%",
        },
      ],
      warningEvents: [
        {
          name: "web-1",
          namespace: "prod",
          reason: "OOMKilling",
          message: "Memory cgroup OOM",
          lastTimestamp: "2026-03-21T10:01:00Z",
          count: 1,
        },
      ],
      deploymentChanges: [
        {
          name: "web",
          namespace: "prod",
          generation: 5,
          timestamp: "2026-03-21T09:55:00Z",
          replicas: 3,
        },
      ],
    });
    expect(result.items).toHaveLength(4);
    // Chronological order
    expect(result.items[0].kind).toBe("deployment-change"); // 09:55
    expect(result.items[1].kind).toBe("alert-firing"); // 10:00
    expect(result.items[2].kind).toBe("event-warning"); // 10:01
    expect(result.items[3].kind).toBe("pod-restart"); // 10:02
  });

  it("detects peak minute", () => {
    const result = buildIncidentTimeline({
      podRestarts: [
        {
          podName: "a",
          namespace: "ns",
          containerName: "c",
          restartCount: 1,
          reason: "Error",
          timestamp: "2026-03-21T10:00:00Z",
        },
        {
          podName: "b",
          namespace: "ns",
          containerName: "c",
          restartCount: 1,
          reason: "Error",
          timestamp: "2026-03-21T10:00:10Z",
        },
        {
          podName: "c",
          namespace: "ns",
          containerName: "c",
          restartCount: 1,
          reason: "Error",
          timestamp: "2026-03-21T10:00:20Z",
        },
      ],
    });
    expect(result.peakMinute).not.toBeNull();
  });

  it("counts severities", () => {
    const result = buildIncidentTimeline({
      alerts: [
        {
          name: "a",
          namespace: "ns",
          severity: "critical",
          status: "firing",
          startsAt: "2026-03-21T10:00:00Z",
          message: "",
        },
        {
          name: "b",
          namespace: "ns",
          severity: "warning",
          status: "firing",
          startsAt: "2026-03-21T10:01:00Z",
          message: "",
        },
      ],
      deploymentChanges: [
        {
          name: "d",
          namespace: "ns",
          generation: 1,
          timestamp: "2026-03-21T10:02:00Z",
          replicas: 1,
        },
      ],
    });
    expect(result.criticalCount).toBe(1);
    expect(result.warningCount).toBe(1);
    expect(result.infoCount).toBe(1);
  });

  it("handles empty input", () => {
    const result = buildIncidentTimeline({});
    expect(result.items).toHaveLength(0);
    expect(result.peakMinute).toBeNull();
  });
});
