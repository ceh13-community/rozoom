import { describe, expect, it } from "vitest";
import { parseWarningEventJsonLine } from "./warning-events-parser";

describe("warning-events-parser", () => {
  it("parses warning event watch line", () => {
    const parsed = parseWarningEventJsonLine(
      JSON.stringify({
        type: "ADDED",
        object: {
          type: "Warning",
          reason: "BackOff",
          metadata: { namespace: "default", uid: "uid-1" },
          involvedObject: { kind: "Pod", name: "demo" },
          message: "Back-off restarting container",
          lastTimestamp: new Date().toISOString(),
        },
      }),
    );

    expect(parsed?.kind).toBe("warning-event");
  });

  it("ignores malformed lines", () => {
    expect(parseWarningEventJsonLine("not-json")).toBeNull();
    expect(parseWarningEventJsonLine(JSON.stringify({}))).toBeNull();
  });
});
