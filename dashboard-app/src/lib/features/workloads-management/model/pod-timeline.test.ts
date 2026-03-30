import { describe, expect, it } from "vitest";
import { buildPodTimeline } from "./pod-timeline";

describe("pod-timeline", () => {
  it("builds timeline for healthy running pod", () => {
    const result = buildPodTimeline({
      metadata: { name: "web-1", namespace: "default", creationTimestamp: "2026-03-20T10:00:00Z" },
      spec: { nodeName: "node-1" },
      status: {
        phase: "Running",
        conditions: [
          { type: "PodScheduled", status: "True", lastTransitionTime: "2026-03-20T10:00:01Z" },
          { type: "Initialized", status: "True", lastTransitionTime: "2026-03-20T10:00:02Z" },
        ],
        containerStatuses: [
          {
            name: "app",
            restartCount: 0,
            state: { running: { startedAt: "2026-03-20T10:00:03Z" } },
            lastState: {},
          },
        ],
      },
    });
    expect(result.healthSummary).toBe("healthy");
    expect(result.totalRestarts).toBe(0);
    expect(result.events.length).toBeGreaterThanOrEqual(3);
    expect(result.events[0].kind).toBe("created");
  });

  it("detects OOM killed container", () => {
    const result = buildPodTimeline({
      metadata: {
        name: "oom-pod",
        namespace: "default",
        creationTimestamp: "2026-03-20T10:00:00Z",
      },
      spec: {},
      status: {
        phase: "Running",
        conditions: [],
        containerStatuses: [
          {
            name: "app",
            restartCount: 3,
            state: { running: { startedAt: "2026-03-20T12:00:00Z" } },
            lastState: {
              terminated: {
                reason: "OOMKilled",
                exitCode: 137,
                finishedAt: "2026-03-20T11:59:00Z",
              },
            },
          },
        ],
      },
    });
    expect(result.oomKills).toBe(1);
    expect(result.healthSummary).toBe("failing");
    expect(result.events.some((e) => e.kind === "oom-killed")).toBe(true);
  });

  it("detects CrashLoopBackOff", () => {
    const result = buildPodTimeline({
      metadata: {
        name: "crash-pod",
        namespace: "default",
        creationTimestamp: "2026-03-20T10:00:00Z",
      },
      spec: {},
      status: {
        phase: "Running",
        conditions: [],
        containerStatuses: [
          {
            name: "app",
            restartCount: 5,
            state: { waiting: { reason: "CrashLoopBackOff", message: "back-off restarting" } },
            lastState: { terminated: { reason: "Error", exitCode: 1 } },
          },
        ],
      },
    });
    expect(result.healthSummary).toBe("failing");
    expect(result.events.some((e) => e.kind === "crash-loop")).toBe(true);
  });

  it("detects evicted pod", () => {
    const result = buildPodTimeline({
      metadata: {
        name: "evicted",
        namespace: "default",
        creationTimestamp: "2026-03-20T10:00:00Z",
      },
      spec: {},
      status: {
        phase: "Failed",
        reason: "Evicted",
        message: "Node disk pressure",
        conditions: [],
        containerStatuses: [],
      },
    });
    expect(result.events.some((e) => e.kind === "evicted")).toBe(true);
  });

  it("detects deletion", () => {
    const result = buildPodTimeline({
      metadata: {
        name: "deleting",
        namespace: "default",
        creationTimestamp: "2026-03-20T10:00:00Z",
        deletionTimestamp: "2026-03-20T14:00:00Z",
        deletionGracePeriodSeconds: 30,
      },
      spec: {},
      status: { phase: "Running", conditions: [], containerStatuses: [] },
    });
    expect(result.events.some((e) => e.kind === "deleted")).toBe(true);
  });

  it("sorts events by timestamp", () => {
    const result = buildPodTimeline({
      metadata: { name: "web", namespace: "default", creationTimestamp: "2026-03-20T10:00:00Z" },
      spec: { nodeName: "node-1" },
      status: {
        phase: "Running",
        conditions: [
          { type: "PodScheduled", status: "True", lastTransitionTime: "2026-03-20T10:00:02Z" },
          { type: "Initialized", status: "True", lastTransitionTime: "2026-03-20T10:00:01Z" },
        ],
        containerStatuses: [],
      },
    });
    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i].timestamp).toBeGreaterThanOrEqual(result.events[i - 1].timestamp);
    }
  });
});
