import { afterEach, describe, expect, it } from "vitest";
import {
  forgetCluster,
  isMetricsServerKnownAvailable,
  recordMetricsServerAvailable,
  recordMetricsServerUnavailable,
  resetMetricsServerAvailabilityCacheForTests,
} from "./metrics-server-availability";

afterEach(() => {
  resetMetricsServerAvailabilityCacheForTests();
});

describe("metrics-server availability cache", () => {
  it("returns false for unknown clusters", () => {
    expect(isMetricsServerKnownAvailable("cluster-a")).toBe(false);
  });

  it("returns true after recording availability within the freshness window", () => {
    recordMetricsServerAvailable("cluster-a", 1_000);
    expect(isMetricsServerKnownAvailable("cluster-a", 2_000)).toBe(true);
  });

  it("returns false once the freshness window elapses", () => {
    recordMetricsServerAvailable("cluster-a", 0);
    const elevenMinutesLater = 11 * 60 * 1000;
    expect(isMetricsServerKnownAvailable("cluster-a", elevenMinutesLater)).toBe(false);
  });

  it("is per-cluster: observations on one cluster do not leak to another", () => {
    recordMetricsServerAvailable("cluster-a", 0);
    expect(isMetricsServerKnownAvailable("cluster-b", 0)).toBe(false);
  });

  it("an explicit unavailable observation clears the available flag", () => {
    recordMetricsServerAvailable("cluster-a", 0);
    recordMetricsServerUnavailable("cluster-a", 100);
    expect(isMetricsServerKnownAvailable("cluster-a", 200)).toBe(false);
  });

  it("re-observing available after unavailable restores the skip", () => {
    recordMetricsServerUnavailable("cluster-a", 0);
    recordMetricsServerAvailable("cluster-a", 100);
    expect(isMetricsServerKnownAvailable("cluster-a", 200)).toBe(true);
  });

  it("forgetCluster clears the entry", () => {
    recordMetricsServerAvailable("cluster-a", 0);
    forgetCluster("cluster-a");
    expect(isMetricsServerKnownAvailable("cluster-a", 100)).toBe(false);
  });
});
