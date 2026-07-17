import type { SyntheticStressPreset } from "./synthetic-fleet";

export type SyntheticRunVerdict = "Healthy" | "Saturated" | "Queue bound";

export type SyntheticPresetReport = {
  completedAt: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  peakQueue: number;
  saturatedCount: number;
  verdict: SyntheticRunVerdict;
};

export type SyntheticPresetReports = Partial<Record<SyntheticStressPreset, SyntheticPresetReport>>;

export type SyntheticRunReport = {
  completedAt: number | null;
  sampleSize: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  peakQueue: number;
  saturatedCount: number;
  preset?: SyntheticStressPreset;
};

export type SlowCardRow = {
  clusterId: string;
  latestDurationMs: number | null;
  p95DurationMs: number | null;
  samples: number;
  lastAt: number | null;
  pending: boolean;
  loading: boolean;
};

export const PRESET_REGRESSION_THRESHOLDS = {
  p95Ms: 2_500,
  maxMs: 4_500,
  peakQueue: 14,
  saturatedCount: 18,
} as const;

export const SATURATED_DURATION_MS = 1_200;
export const QUEUE_BOUND_DURATION_MS = 2_500;
export const QUEUE_BOUND_QUEUE_SIZE = 12;

export const EMPTY_RUN_REPORT: SyntheticRunReport = {
  completedAt: null,
  sampleSize: 0,
  p50Ms: null,
  p95Ms: null,
  maxMs: null,
  peakQueue: 0,
  saturatedCount: 0,
  preset: undefined,
};

export function percentile(values: number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[index] ?? null;
}

export function formatDuration(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${Math.round(value)}ms`;
}

export function formatAt(value: number | null) {
  if (!value) return "n/a";
  return new Date(value).toLocaleTimeString();
}

export function formatDelta(value: number | null) {
  if (value == null || value === 0) return "0ms";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${Math.round(value)}ms`;
}

export function withSyntheticJitter(profile: { seed: number; durationMs: number }) {
  return profile.durationMs + (profile.seed % 7) * 35;
}

export function computeLiveVerdict(input: {
  queued: number;
  running: number;
  maxDurationMs: number;
}): SyntheticRunVerdict {
  if (input.queued > QUEUE_BOUND_QUEUE_SIZE || input.maxDurationMs > QUEUE_BOUND_DURATION_MS) {
    return "Queue bound";
  }
  if (input.running > 0 || input.maxDurationMs > SATURATED_DURATION_MS) return "Saturated";
  return "Healthy";
}

export function computeRunVerdict(input: {
  peakQueue: number;
  durations: number[];
  saturatedCount: number;
}): SyntheticRunVerdict {
  const maxDurationMs = input.durations.length > 0 ? Math.max(...input.durations) : 0;
  if (input.peakQueue > QUEUE_BOUND_QUEUE_SIZE || maxDurationMs > QUEUE_BOUND_DURATION_MS) {
    return "Queue bound";
  }
  if (input.saturatedCount > 0) return "Saturated";
  return "Healthy";
}

export function buildRunReport(input: {
  durations: number[];
  peakQueue: number;
  saturatedCount: number;
  preset: SyntheticStressPreset;
  completedAt: number;
}): { run: SyntheticRunReport; presetReport: SyntheticPresetReport } {
  const run: SyntheticRunReport = {
    completedAt: input.completedAt,
    sampleSize: input.durations.length,
    p50Ms: percentile(input.durations, 0.5),
    p95Ms: percentile(input.durations, 0.95),
    maxMs: input.durations.length > 0 ? Math.max(...input.durations) : null,
    peakQueue: input.peakQueue,
    saturatedCount: input.saturatedCount,
    preset: input.preset,
  };
  const presetReport: SyntheticPresetReport = {
    completedAt: run.completedAt,
    p95Ms: run.p95Ms,
    maxMs: run.maxMs,
    peakQueue: run.peakQueue,
    saturatedCount: run.saturatedCount,
    verdict: computeRunVerdict(input),
  };
  return { run, presetReport };
}

export function hasPresetRegression(report: SyntheticPresetReport | undefined) {
  return (
    (report?.p95Ms ?? 0) > PRESET_REGRESSION_THRESHOLDS.p95Ms ||
    (report?.maxMs ?? 0) > PRESET_REGRESSION_THRESHOLDS.maxMs ||
    (report?.peakQueue ?? 0) > PRESET_REGRESSION_THRESHOLDS.peakQueue ||
    (report?.saturatedCount ?? 0) > PRESET_REGRESSION_THRESHOLDS.saturatedCount
  );
}

export function mergeSlowCardRows(rows: SlowCardRow[], limit = 8) {
  const merged = rows.reduce<Map<string, SlowCardRow>>((byCluster, row) => {
    const current = byCluster.get(row.clusterId);
    if (!current || (row.latestDurationMs ?? -1) >= (current.latestDurationMs ?? -1)) {
      byCluster.set(row.clusterId, row);
    }
    return byCluster;
  }, new Map());

  return [...merged.values()]
    .sort((left, right) => (right.latestDurationMs ?? 0) - (left.latestDurationMs ?? 0))
    .slice(0, limit);
}
