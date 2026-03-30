import { describe, expect, it } from "vitest";
import { buildWorkloadEventsArgs, parseWorkloadEventsOutput } from "./workload-events";

describe("workload-events helpers", () => {
  it("builds kubectl events args for a namespaced workload", () => {
    expect(
      buildWorkloadEventsArgs({
        resource: "deployment",
        name: "api",
        namespace: "prod",
      }),
    ).toEqual(["events", "--namespace", "prod", "--for", "deployment/api", "-o", "json"]);
  });

  it("parses workload events output", () => {
    expect(
      parseWorkloadEventsOutput(
        JSON.stringify({
          items: [
            {
              type: "Warning",
              reason: "FailedMount",
              message: "boom",
              eventTime: "2026-03-13T10:00:00Z",
              source: { component: "kubelet" },
              count: 4,
            },
          ],
        }),
      ),
    ).toEqual([
      {
        type: "Warning",
        reason: "FailedMount",
        message: "boom",
        lastTimestamp: "2026-03-13T10:00:00Z",
        source: "kubelet",
        count: 4,
      },
    ]);
  });
});
