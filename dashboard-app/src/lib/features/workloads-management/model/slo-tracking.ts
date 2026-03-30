/**
 * SLO / Error Budget tracking model.
 *
 * Based on:
 *   - https://sre.google/sre-book/service-level-objectives/
 *     "Error Budget = 1 - SLO target"
 *   - https://sre.google/workbook/alerting-on-slos/
 *     "Burn Rate = Error Rate / (1 - SLO)"
 *
 * Multi-window burn rate alerting (Google SRE Workbook):
 *   - Page:   1h window at 14.4x burn + 5min short window
 *   - Page:   6h window at 6x burn + 30min short window
 *   - Ticket: 3d window at 1x burn + 6h short window
 */

export type SloDefinition = {
  id: string;
  name: string;
  service: string;
  namespace: string;
  target: number;
  windowDays: number;
  sliType: "availability" | "latency" | "throughput";
  latencyThresholdMs?: number;
};

export type SloStatus = {
  definition: SloDefinition;
  currentSli: number;
  errorBudgetTotal: number;
  errorBudgetRemaining: number;
  errorBudgetConsumedPercent: number;
  burnRate: number;
  timeToExhaustionHours: number | null;
  status: "ok" | "warning" | "critical" | "exhausted";
  alerts: SloAlert[];
};

export type SloAlert = {
  severity: "page" | "ticket";
  window: string;
  burnRate: number;
  threshold: number;
  firing: boolean;
};

export type SloReport = {
  slos: SloStatus[];
  summary: {
    total: number;
    ok: number;
    warning: number;
    critical: number;
    exhausted: number;
  };
};

type SloInput = {
  definition: SloDefinition;
  totalRequests: number;
  goodRequests: number;
  windowElapsedHours: number;
};

/**
 * Multi-window burn rate alert thresholds.
 * From https://sre.google/workbook/alerting-on-slos/
 *
 * For a 30-day SLO window:
 *   14.4x burn = 2% budget consumed in 1 hour
 *   6x burn = 5% budget consumed in 6 hours
 *   1x burn = 10% budget consumed in 3 days
 */
const ALERT_WINDOWS: Array<{
  severity: "page" | "ticket";
  window: string;
  burnRateThreshold: number;
}> = [
  { severity: "page", window: "1h", burnRateThreshold: 14.4 },
  { severity: "page", window: "6h", burnRateThreshold: 6 },
  { severity: "ticket", window: "3d", burnRateThreshold: 1 },
];

function calculateBurnRate(errorRate: number, sloTarget: number): number {
  const errorBudgetRate = 1 - sloTarget;
  if (errorBudgetRate <= 0) return 0;
  return Math.round((errorRate / errorBudgetRate) * 100) / 100;
}

function gradeSlo(budgetConsumedPercent: number, burnRate: number): SloStatus["status"] {
  if (budgetConsumedPercent >= 100) return "exhausted";
  if (burnRate >= 6) return "critical";
  if (burnRate >= 1 || budgetConsumedPercent >= 75) return "warning";
  return "ok";
}

export function evaluateSlo(input: SloInput): SloStatus {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for future multi-window burn rate calculation
  const { definition, totalRequests, goodRequests, windowElapsedHours } = input;
  const windowTotalHours = definition.windowDays * 24;

  const currentSli =
    totalRequests > 0 ? Math.round((goodRequests / totalRequests) * 100000) / 100000 : 1;

  const errorRate = 1 - currentSli;
  const errorBudgetTotal = 1 - definition.target;
  const errorBudgetConsumed = errorRate;
  const errorBudgetRemaining = Math.max(0, errorBudgetTotal - errorBudgetConsumed);
  const errorBudgetConsumedPercent =
    errorBudgetTotal > 0 ? Math.round((errorBudgetConsumed / errorBudgetTotal) * 10000) / 100 : 0;

  const burnRate = calculateBurnRate(errorRate, definition.target);

  const timeToExhaustion =
    burnRate > 0 && errorBudgetRemaining > 0
      ? Math.round(
          (((errorBudgetRemaining / errorBudgetTotal) * windowTotalHours) / burnRate) * 10,
        ) / 10
      : burnRate > 0
        ? 0
        : null;

  const alerts: SloAlert[] = ALERT_WINDOWS.map((aw) => ({
    severity: aw.severity,
    window: aw.window,
    burnRate,
    threshold: aw.burnRateThreshold,
    firing: burnRate >= aw.burnRateThreshold,
  }));

  return {
    definition,
    currentSli: Math.round(currentSli * 100000) / 100000,
    errorBudgetTotal: Math.round(errorBudgetTotal * 100000) / 100000,
    errorBudgetRemaining: Math.round(errorBudgetRemaining * 100000) / 100000,
    errorBudgetConsumedPercent,
    burnRate,
    timeToExhaustionHours: timeToExhaustion,
    status: gradeSlo(errorBudgetConsumedPercent, burnRate),
    alerts,
  };
}

export function buildSloReport(inputs: SloInput[]): SloReport {
  const slos = inputs.map(evaluateSlo);

  return {
    slos,
    summary: {
      total: slos.length,
      ok: slos.filter((s) => s.status === "ok").length,
      warning: slos.filter((s) => s.status === "warning").length,
      critical: slos.filter((s) => s.status === "critical").length,
      exhausted: slos.filter((s) => s.status === "exhausted").length,
    },
  };
}
