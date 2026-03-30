import { describe, expect, it } from "vitest";
import { predictRestarts } from "./restart-prediction";

describe("restart-prediction", () => {
  it("predicts next restart from interval", () => {
    const result = predictRestarts([
      {
        name: "crash-pod",
        namespace: "default",
        restartCount: 5,
        lastRestartAt: "2026-03-21T10:30:00Z",
        previousRestartAt: "2026-03-21T10:00:00Z",
        createdAt: "2026-03-21T08:00:00Z",
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe("high");
    expect(result[0].avgIntervalMs).toBe(30 * 60000);
  });

  it("skips pods with < 2 restarts", () => {
    const result = predictRestarts([
      {
        name: "ok",
        namespace: "default",
        restartCount: 1,
        lastRestartAt: null,
        previousRestartAt: null,
        createdAt: "2026-03-21T08:00:00Z",
      },
    ]);
    expect(result).toHaveLength(0);
  });

  it("sorts by predicted next (soonest first)", () => {
    const result = predictRestarts([
      {
        name: "later",
        namespace: "ns",
        restartCount: 3,
        lastRestartAt: "2026-03-21T10:00:00Z",
        previousRestartAt: "2026-03-21T08:00:00Z",
        createdAt: "2026-03-21T06:00:00Z",
      },
      {
        name: "sooner",
        namespace: "ns",
        restartCount: 5,
        lastRestartAt: "2026-03-21T10:50:00Z",
        previousRestartAt: "2026-03-21T10:40:00Z",
        createdAt: "2026-03-21T10:00:00Z",
      },
    ]);
    expect(result[0].podName).toBe("sooner");
  });
});
