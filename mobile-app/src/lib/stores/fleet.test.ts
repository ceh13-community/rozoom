import { describe, it, expect } from "vitest";
import { get } from "svelte/store";
import { clusters, alerts, scoreToStatus } from "./fleet";

describe("fleet store", () => {
  it("should have demo clusters loaded", () => {
    const list = get(clusters);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toHaveProperty("id");
    expect(list[0]).toHaveProperty("name");
    expect(list[0]).toHaveProperty("score");
    expect(list[0]).toHaveProperty("status");
  });

  it("should have demo alerts loaded", () => {
    const list = get(alerts);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toHaveProperty("severity");
    expect(list[0]).toHaveProperty("title");
  });

  it("each cluster should have valid status matching score", () => {
    const list = get(clusters);
    for (const c of list) {
      expect(c.status).toBe(scoreToStatus(c.score));
    }
  });
});

describe("scoreToStatus", () => {
  it("returns healthy for score >= 80", () => {
    expect(scoreToStatus(80)).toBe("healthy");
    expect(scoreToStatus(100)).toBe("healthy");
    expect(scoreToStatus(92)).toBe("healthy");
  });

  it("returns warning for score 50-79", () => {
    expect(scoreToStatus(50)).toBe("warning");
    expect(scoreToStatus(79)).toBe("warning");
    expect(scoreToStatus(65)).toBe("warning");
  });

  it("returns critical for score < 50", () => {
    expect(scoreToStatus(49)).toBe("critical");
    expect(scoreToStatus(0)).toBe("critical");
    expect(scoreToStatus(38)).toBe("critical");
  });
});
