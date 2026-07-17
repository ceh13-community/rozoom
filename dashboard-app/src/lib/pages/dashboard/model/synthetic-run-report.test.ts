import { describe, expect, it } from "vitest";
import {
  buildRunReport,
  computeLiveVerdict,
  computeRunVerdict,
  EMPTY_RUN_REPORT,
  formatAt,
  formatDelta,
  formatDuration,
  hasPresetRegression,
  mergeSlowCardRows,
  percentile,
  PRESET_REGRESSION_THRESHOLDS,
  withSyntheticJitter,
  type SlowCardRow,
  type SyntheticPresetReport,
} from "./synthetic-run-report";

function slowCardRow(overrides: Partial<SlowCardRow>): SlowCardRow {
  return {
    clusterId: "synthetic-50-001",
    latestDurationMs: null,
    p95DurationMs: null,
    samples: 0,
    lastAt: null,
    pending: false,
    loading: false,
    ...overrides,
  };
}

function presetReport(overrides: Partial<SyntheticPresetReport>): SyntheticPresetReport {
  return {
    completedAt: 1_000,
    p95Ms: 500,
    maxMs: 900,
    peakQueue: 4,
    saturatedCount: 0,
    verdict: "Healthy",
    ...overrides,
  };
}

describe("percentile", () => {
  it("returns null for empty samples", () => {
    expect(percentile([], 0.95)).toBeNull();
  });

  it("computes p50 and p95 on sorted copies without mutating input", () => {
    const values = [900, 100, 500, 300, 700];
    expect(percentile(values, 0.5)).toBe(500);
    expect(percentile(values, 0.95)).toBe(900);
    expect(values).toEqual([900, 100, 500, 300, 700]);
  });

  it("clamps the index for small samples", () => {
    expect(percentile([250], 0.95)).toBe(250);
  });
});

describe("formatters", () => {
  it("formats durations, falling back to n/a", () => {
    expect(formatDuration(1234.4)).toBe("1234ms");
    expect(formatDuration(null)).toBe("n/a");
    expect(formatDuration(Number.NaN)).toBe("n/a");
  });

  it("formats deltas with an explicit sign", () => {
    expect(formatDelta(120.6)).toBe("+121ms");
    expect(formatDelta(-80)).toBe("-80ms");
    expect(formatDelta(0)).toBe("0ms");
    expect(formatDelta(null)).toBe("0ms");
  });

  it("formats timestamps, falling back to n/a", () => {
    expect(formatAt(null)).toBe("n/a");
    expect(formatAt(Date.UTC(2026, 6, 16, 12, 0, 0))).not.toBe("n/a");
  });
});

describe("withSyntheticJitter", () => {
  it("adds deterministic seed-based jitter", () => {
    expect(withSyntheticJitter({ seed: 0, durationMs: 400 })).toBe(400);
    expect(withSyntheticJitter({ seed: 3, durationMs: 400 })).toBe(505);
    expect(withSyntheticJitter({ seed: 7, durationMs: 400 })).toBe(400);
  });
});

describe("verdicts", () => {
  it("marks live telemetry queue bound before saturated", () => {
    expect(computeLiveVerdict({ queued: 13, running: 0, maxDurationMs: 100 })).toBe("Queue bound");
    expect(computeLiveVerdict({ queued: 0, running: 0, maxDurationMs: 2_600 })).toBe("Queue bound");
    expect(computeLiveVerdict({ queued: 0, running: 1, maxDurationMs: 100 })).toBe("Saturated");
    expect(computeLiveVerdict({ queued: 0, running: 0, maxDurationMs: 1_300 })).toBe("Saturated");
    expect(computeLiveVerdict({ queued: 0, running: 0, maxDurationMs: 100 })).toBe("Healthy");
  });

  it("marks finished runs by peak queue, max duration, then saturation", () => {
    expect(computeRunVerdict({ peakQueue: 13, durations: [100], saturatedCount: 0 })).toBe(
      "Queue bound",
    );
    expect(computeRunVerdict({ peakQueue: 0, durations: [2_600], saturatedCount: 0 })).toBe(
      "Queue bound",
    );
    expect(computeRunVerdict({ peakQueue: 0, durations: [100], saturatedCount: 2 })).toBe(
      "Saturated",
    );
    expect(computeRunVerdict({ peakQueue: 0, durations: [], saturatedCount: 0 })).toBe("Healthy");
  });
});

describe("buildRunReport", () => {
  it("aggregates run samples into run and preset reports", () => {
    const { run, presetReport: report } = buildRunReport({
      durations: [200, 400, 3_000],
      peakQueue: 6,
      saturatedCount: 1,
      preset: "balanced",
      completedAt: 42,
    });

    expect(run).toEqual({
      completedAt: 42,
      sampleSize: 3,
      p50Ms: 400,
      p95Ms: 3_000,
      maxMs: 3_000,
      peakQueue: 6,
      saturatedCount: 1,
      preset: "balanced",
    });
    expect(report).toMatchObject({ p95Ms: 3_000, verdict: "Queue bound" });
  });

  it("keeps empty runs aligned with the empty report shape", () => {
    const { run } = buildRunReport({
      durations: [],
      peakQueue: 0,
      saturatedCount: 0,
      preset: "balanced",
      completedAt: 42,
    });
    expect(run).toEqual({ ...EMPTY_RUN_REPORT, completedAt: 42, preset: "balanced" });
  });
});

describe("hasPresetRegression", () => {
  it("is false without a report or within thresholds", () => {
    expect(hasPresetRegression(undefined)).toBe(false);
    expect(hasPresetRegression(presetReport({}))).toBe(false);
  });

  it("flags any threshold breach", () => {
    expect(
      hasPresetRegression(presetReport({ p95Ms: PRESET_REGRESSION_THRESHOLDS.p95Ms + 1 })),
    ).toBe(true);
    expect(
      hasPresetRegression(presetReport({ maxMs: PRESET_REGRESSION_THRESHOLDS.maxMs + 1 })),
    ).toBe(true);
    expect(
      hasPresetRegression(presetReport({ peakQueue: PRESET_REGRESSION_THRESHOLDS.peakQueue + 1 })),
    ).toBe(true);
    expect(
      hasPresetRegression(
        presetReport({ saturatedCount: PRESET_REGRESSION_THRESHOLDS.saturatedCount + 1 }),
      ),
    ).toBe(true);
  });
});

describe("mergeSlowCardRows", () => {
  it("keeps the slowest row per cluster and sorts descending", () => {
    const merged = mergeSlowCardRows([
      slowCardRow({ clusterId: "a", latestDurationMs: 100 }),
      slowCardRow({ clusterId: "a", latestDurationMs: 900, loading: true }),
      slowCardRow({ clusterId: "b", latestDurationMs: 400 }),
    ]);

    expect(merged.map((row) => row.clusterId)).toEqual(["a", "b"]);
    expect(merged[0]).toMatchObject({ latestDurationMs: 900, loading: true });
  });

  it("limits the merged rows", () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      slowCardRow({ clusterId: `cluster-${index}`, latestDurationMs: index }),
    );
    expect(mergeSlowCardRows(rows)).toHaveLength(8);
    expect(mergeSlowCardRows(rows, 3)).toHaveLength(3);
  });
});
