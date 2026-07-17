import type { SyntheticPresetReport, SyntheticPresetReports } from "./synthetic-run-report";
import { hasPresetRegression } from "./synthetic-run-report";

export type SyntheticHistorySnapshot = {
  savedAt: number;
  fleetSize: number;
  reports: SyntheticPresetReports;
};

type SyntheticHistoryStorage = {
  fleetSize: number;
  snapshots: SyntheticHistorySnapshot[];
};

export type PresetReportDeltas = {
  p95Delta: number | null;
  maxDelta: number | null;
  queueDelta: number | null;
};

export type ComparisonDeltaSummary = {
  samples: number;
  avgP95DeltaMs: number;
  avgMaxDeltaMs: number;
  avgQueueDelta: number;
  regressions: number;
};

export type HistorySnapshotSummary = {
  savedAt: number;
  p95Ms: number | null;
  maxMs: number | null;
  peakQueue: number;
  regressions: number;
};

export const COMPARISON_HISTORY_LIMIT = 8;

type HistoryStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStore(): HistoryStore | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function historyStorageKey(fleetSize: number) {
  return `synthetic-fleet-comparison-history:${fleetSize}`;
}

export function readComparisonHistory(
  fleetSize: number,
  store: HistoryStore | null = defaultStore(),
): SyntheticHistorySnapshot[] {
  if (!store) return [];
  const raw = store.getItem(historyStorageKey(fleetSize));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const payload = parsed as SyntheticHistoryStorage | SyntheticHistorySnapshot;
    if ("snapshots" in payload) {
      return payload.fleetSize === fleetSize ? payload.snapshots : [];
    }
    return payload.fleetSize === fleetSize ? [payload] : [];
  } catch {
    return [];
  }
}

export function appendComparisonSnapshot(
  history: SyntheticHistorySnapshot[],
  snapshot: SyntheticHistorySnapshot,
) {
  return [...history, snapshot].slice(-COMPARISON_HISTORY_LIMIT);
}

export function persistComparisonHistory(
  fleetSize: number,
  snapshots: SyntheticHistorySnapshot[],
  store: HistoryStore | null = defaultStore(),
) {
  if (!store) return;
  const payload: SyntheticHistoryStorage = { fleetSize, snapshots };
  store.setItem(historyStorageKey(fleetSize), JSON.stringify(payload));
}

export function clearComparisonHistoryStorage(
  fleetSize: number,
  store: HistoryStore | null = defaultStore(),
) {
  if (!store) return;
  store.removeItem(historyStorageKey(fleetSize));
}

export function diffPresetReports(
  current: SyntheticPresetReport | undefined,
  previous: SyntheticPresetReport | undefined,
): PresetReportDeltas {
  return {
    p95Delta:
      current?.p95Ms != null && previous?.p95Ms != null ? current.p95Ms - previous.p95Ms : null,
    maxDelta:
      current?.maxMs != null && previous?.maxMs != null ? current.maxMs - previous.maxMs : null,
    queueDelta: current != null && previous != null ? current.peakQueue - previous.peakQueue : null,
  };
}

export function summarizeComparisonDeltas(
  rows: Array<
    PresetReportDeltas & {
      current: SyntheticPresetReport | undefined;
      previous: SyntheticPresetReport | undefined;
    }
  >,
): ComparisonDeltaSummary | null {
  const compared = rows.filter((row) => row.current && row.previous);
  if (compared.length === 0) return null;
  const p95Delta = compared.reduce((sum, row) => sum + (row.p95Delta ?? 0), 0);
  const maxDelta = compared.reduce((sum, row) => sum + (row.maxDelta ?? 0), 0);
  const queueDelta = compared.reduce((sum, row) => sum + (row.queueDelta ?? 0), 0);
  const regressions = compared.filter(
    (row) =>
      (row.current?.p95Ms ?? 0) > (row.previous?.p95Ms ?? 0) ||
      (row.current?.maxMs ?? 0) > (row.previous?.maxMs ?? 0) ||
      (row.current?.peakQueue ?? 0) > (row.previous?.peakQueue ?? 0),
  ).length;
  return {
    samples: compared.length,
    avgP95DeltaMs: p95Delta / compared.length,
    avgMaxDeltaMs: maxDelta / compared.length,
    avgQueueDelta: queueDelta / compared.length,
    regressions,
  };
}

export function summarizeHistorySnapshot(
  snapshot: SyntheticHistorySnapshot,
): HistorySnapshotSummary {
  const reports = Object.values(snapshot.reports).filter(Boolean);
  const p95Values = reports
    .map((report) => report.p95Ms)
    .filter((value): value is number => value != null);
  const maxValues = reports
    .map((report) => report.maxMs)
    .filter((value): value is number => value != null);
  const peakQueue = reports.reduce((peak, report) => Math.max(peak, report.peakQueue), 0);
  const regressions = reports.filter((report) => hasPresetRegression(report)).length;
  return {
    savedAt: snapshot.savedAt,
    p95Ms: p95Values.length > 0 ? Math.max(...p95Values) : null,
    maxMs: maxValues.length > 0 ? Math.max(...maxValues) : null,
    peakQueue,
    regressions,
  };
}
