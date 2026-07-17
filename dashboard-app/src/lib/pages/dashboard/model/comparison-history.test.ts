import { describe, expect, it } from "vitest";
import {
  appendComparisonSnapshot,
  clearComparisonHistoryStorage,
  COMPARISON_HISTORY_LIMIT,
  diffPresetReports,
  historyStorageKey,
  persistComparisonHistory,
  readComparisonHistory,
  summarizeComparisonDeltas,
  summarizeHistorySnapshot,
  type SyntheticHistorySnapshot,
} from "./comparison-history";
import type { SyntheticPresetReport } from "./synthetic-run-report";

function memoryStore(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
    dump: () => Object.fromEntries(items),
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

function snapshot(overrides: Partial<SyntheticHistorySnapshot>): SyntheticHistorySnapshot {
  return {
    savedAt: 1_000,
    fleetSize: 50,
    reports: { balanced: presetReport({}) },
    ...overrides,
  };
}

describe("comparison history storage", () => {
  it("round-trips snapshots through storage", () => {
    const store = memoryStore();
    const snapshots = [snapshot({ savedAt: 1 }), snapshot({ savedAt: 2 })];

    persistComparisonHistory(50, snapshots, store);
    expect(readComparisonHistory(50, store)).toEqual(snapshots);
  });

  it("ignores history saved for a different fleet size", () => {
    const store = memoryStore();
    persistComparisonHistory(100, [snapshot({ fleetSize: 100 })], store);

    expect(readComparisonHistory(100, store)).toHaveLength(1);
    expect(readComparisonHistory(50, store)).toEqual([]);
  });

  it("accepts the legacy single-snapshot payload", () => {
    const store = memoryStore({
      [historyStorageKey(50)]: JSON.stringify(snapshot({ savedAt: 7 })),
    });
    expect(readComparisonHistory(50, store)).toEqual([snapshot({ savedAt: 7 })]);
  });

  it("returns empty history for corrupted payloads", () => {
    const store = memoryStore({ [historyStorageKey(50)]: "{not json" });
    expect(readComparisonHistory(50, store)).toEqual([]);
  });

  it("returns empty history without a storage backend", () => {
    expect(readComparisonHistory(50, null)).toEqual([]);
  });

  it("clears only the requested fleet history", () => {
    const store = memoryStore();
    persistComparisonHistory(50, [snapshot({})], store);
    persistComparisonHistory(100, [snapshot({ fleetSize: 100 })], store);

    clearComparisonHistoryStorage(50, store);
    expect(readComparisonHistory(50, store)).toEqual([]);
    expect(readComparisonHistory(100, store)).toHaveLength(1);
  });
});

describe("appendComparisonSnapshot", () => {
  it("appends and keeps only the latest snapshots", () => {
    const history = Array.from({ length: COMPARISON_HISTORY_LIMIT }, (_, index) =>
      snapshot({ savedAt: index + 1 }),
    );
    const next = appendComparisonSnapshot(history, snapshot({ savedAt: 99 }));

    expect(next).toHaveLength(COMPARISON_HISTORY_LIMIT);
    expect(next[0]?.savedAt).toBe(2);
    expect(next[next.length - 1]?.savedAt).toBe(99);
  });
});

describe("diffPresetReports", () => {
  it("computes deltas when both reports exist", () => {
    const current = presetReport({ p95Ms: 700, maxMs: 1_100, peakQueue: 6 });
    const previous = presetReport({ p95Ms: 500, maxMs: 900, peakQueue: 4 });

    expect(diffPresetReports(current, previous)).toEqual({
      p95Delta: 200,
      maxDelta: 200,
      queueDelta: 2,
    });
  });

  it("returns null deltas when either side is missing", () => {
    expect(diffPresetReports(presetReport({}), undefined)).toEqual({
      p95Delta: null,
      maxDelta: null,
      queueDelta: null,
    });
    expect(diffPresetReports(presetReport({ p95Ms: null }), presetReport({}))).toMatchObject({
      p95Delta: null,
    });
  });
});

describe("summarizeComparisonDeltas", () => {
  it("returns null when no preset has both runs", () => {
    expect(summarizeComparisonDeltas([])).toBeNull();
    expect(
      summarizeComparisonDeltas([
        {
          current: presetReport({}),
          previous: undefined,
          p95Delta: null,
          maxDelta: null,
          queueDelta: null,
        },
      ]),
    ).toBeNull();
  });

  it("averages deltas and counts regressions across compared presets", () => {
    const summary = summarizeComparisonDeltas([
      {
        current: presetReport({ p95Ms: 700, peakQueue: 6 }),
        previous: presetReport({ p95Ms: 500, peakQueue: 4 }),
        p95Delta: 200,
        maxDelta: 0,
        queueDelta: 2,
      },
      {
        current: presetReport({ p95Ms: 400 }),
        previous: presetReport({ p95Ms: 500 }),
        p95Delta: -100,
        maxDelta: 0,
        queueDelta: 0,
      },
    ]);

    expect(summary).toEqual({
      samples: 2,
      avgP95DeltaMs: 50,
      avgMaxDeltaMs: 0,
      avgQueueDelta: 1,
      regressions: 1,
    });
  });
});

describe("summarizeHistorySnapshot", () => {
  it("reduces a snapshot to worst-case metrics and regression count", () => {
    const summary = summarizeHistorySnapshot(
      snapshot({
        savedAt: 5,
        reports: {
          balanced: presetReport({ p95Ms: 400, maxMs: 800, peakQueue: 3 }),
          slow_fleet: presetReport({ p95Ms: 2_600, maxMs: 4_600, peakQueue: 15 }),
        },
      }),
    );

    expect(summary).toEqual({
      savedAt: 5,
      p95Ms: 2_600,
      maxMs: 4_600,
      peakQueue: 15,
      regressions: 1,
    });
  });

  it("handles snapshots without measurable reports", () => {
    const summary = summarizeHistorySnapshot(
      snapshot({ reports: { balanced: presetReport({ p95Ms: null, maxMs: null }) } }),
    );
    expect(summary).toMatchObject({ p95Ms: null, maxMs: null, peakQueue: 4, regressions: 0 });
  });
});
