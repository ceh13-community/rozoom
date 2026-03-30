import { describe, expect, it } from "vitest";
import {
  buildSyntheticFleet,
  resolveSyntheticRefreshProfile,
  resolveSyntheticFleetSize,
  SYNTHETIC_STRESS_PRESETS,
} from "./synthetic-fleet";

describe("synthetic fleet harness", () => {
  it("accepts only supported fleet sizes", () => {
    expect(resolveSyntheticFleetSize("50")).toBe(50);
    expect(resolveSyntheticFleetSize("100")).toBe(100);
    expect(resolveSyntheticFleetSize("25")).toBeNull();
    expect(resolveSyntheticFleetSize(null)).toBeNull();
  });

  it("builds a seeded fleet with cached checks for each cluster", () => {
    const { clusters, healthChecks } = buildSyntheticFleet(50);

    expect(clusters).toHaveLength(50);
    expect(Object.keys(healthChecks)).toHaveLength(50);
    expect(clusters[0]).toMatchObject({
      uuid: "synthetic-50-001",
      name: "Synthetic Fleet 001",
      needsInitialRefreshHint: false,
      source: "synthetic-fleet-harness",
    });
    expect(healthChecks["synthetic-50-001"]?.[0]).toMatchObject({
      pods: expect.any(Number),
      deployments: expect.any(Number),
      replicaSets: expect.any(Number),
      metricsChecks: {
        endpoints: expect.objectContaining({
          metrics_server: expect.objectContaining({
            status: expect.any(String),
          }),
        }),
      },
    });
  });

  it("derives deterministic synthetic refresh profiles for stress waves", () => {
    expect(resolveSyntheticRefreshProfile("synthetic-50-001")).toEqual(
      expect.objectContaining({
        seed: 1,
        status: expect.any(String),
        durationMs: expect.any(Number),
      }),
    );
    expect(resolveSyntheticRefreshProfile("synthetic-100-017").durationMs).toBeGreaterThan(0);
  });

  it("supports balanced, slow fleet, and queue pressure presets", () => {
    expect(SYNTHETIC_STRESS_PRESETS.map((preset) => preset.id)).toEqual([
      "balanced",
      "slow_fleet",
      "queue_pressure",
    ]);

    const balanced = resolveSyntheticRefreshProfile("synthetic-50-009", "balanced");
    const slowFleet = resolveSyntheticRefreshProfile("synthetic-50-009", "slow_fleet");
    const queuePressure = resolveSyntheticRefreshProfile("synthetic-50-009", "queue_pressure");

    expect(slowFleet.durationMs).toBeGreaterThan(balanced.durationMs);
    expect(queuePressure.durationMs).toBeGreaterThan(slowFleet.durationMs);
  });
});
