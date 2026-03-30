import { describe, expect, it } from "vitest";
import { buildIncidentTimeline, extractRestartPoints } from "./incident-timeline";

describe("extractRestartPoints", () => {
  it("extracts started and terminated timestamps from container statuses", () => {
    const pod = {
      status: {
        containerStatuses: [
          {
            name: "app",
            state: { running: { startedAt: "2026-02-13T10:30:00Z" } },
            lastState: { terminated: { finishedAt: "2026-02-13T10:20:00Z" } },
          },
        ],
      },
    };

    const result = extractRestartPoints(pod);
    expect(result).toHaveLength(2);
    expect(result[0]?.detail).toContain("terminated");
    expect(result[1]?.detail).toContain("started");
  });
});

describe("buildIncidentTimeline", () => {
  it("combines log/event/restart markers and sorts by time", () => {
    const timeline = buildIncidentTimeline({
      logs: "2026-02-13T10:31:00Z ERROR connection refused",
      events: [
        {
          reason: "BackOff",
          type: "Warning",
          message: "Back-off restarting failed container",
          count: 3,
          lastTimestamp: "2026-02-13T10:29:00Z",
          source: "kubelet",
        },
      ],
      restartPoints: [
        { container: "app", ts: Date.parse("2026-02-13T10:30:00Z"), detail: "app started" },
      ],
    });

    expect(timeline).toHaveLength(3);
    expect(timeline.map((item) => item.kind)).toEqual(["events", "restart", "logs"]);
    expect(timeline.map((item) => item.severity)).toEqual(["warning", "warning", "warning"]);
  });
});
