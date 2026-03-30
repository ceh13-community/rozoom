import { describe, expect, it } from "vitest";
import { buildNodeEventsArgs, parseNodeEventsOutput } from "./node-events";

describe("node-events helpers", () => {
  it("builds kubectl events args for a node", () => {
    expect(buildNodeEventsArgs("worker-1")).toEqual([
      "events",
      "--for",
      "node/worker-1",
      "-o",
      "json",
    ]);
  });

  it("parses node events output", () => {
    expect(
      parseNodeEventsOutput(
        JSON.stringify({
          items: [
            {
              type: "Warning",
              reason: "NodeNotReady",
              message: "node is not ready",
              eventTime: "2026-03-13T12:00:00Z",
              source: { component: "node-controller" },
              count: 2,
            },
          ],
        }),
      ),
    ).toEqual([
      {
        type: "Warning",
        reason: "NodeNotReady",
        message: "node is not ready",
        lastTimestamp: "2026-03-13T12:00:00Z",
        source: "node-controller",
        count: 2,
      },
    ]);
  });
});
