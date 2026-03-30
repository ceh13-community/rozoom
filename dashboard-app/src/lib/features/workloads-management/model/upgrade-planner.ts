/**
 * Upgrade Planner (#23)
 *
 * Combines deprecation scan + version audit to recommend safe upgrade path.
 */

export type UpgradeBlocker = {
  kind: string;
  name: string;
  reason: string;
  severity: "blocker" | "warning";
};
export type UpgradePlanResult = {
  currentVersion: string;
  targetVersion: string | null;
  safe: boolean;
  blockers: UpgradeBlocker[];
  warnings: UpgradeBlocker[];
  deprecatedApiCount: number;
  outdatedChartCount: number;
  readinessScore: number;
};

export function buildUpgradePlan(input: {
  currentVersion: string;
  latestVersion: string;
  deprecatedApis: Array<{ kind: string; name: string; removedInVersion: string }>;
  outdatedCharts: Array<{ name: string; currentVersion: string; latestVersion: string }>;
}): UpgradePlanResult {
  const blockers: UpgradeBlocker[] = [];
  const warnings: UpgradeBlocker[] = [];

  for (const api of input.deprecatedApis) {
    if (api.removedInVersion <= input.latestVersion) {
      blockers.push({
        kind: api.kind,
        name: api.name,
        reason: `API removed in ${api.removedInVersion}`,
        severity: "blocker",
      });
    } else {
      warnings.push({
        kind: api.kind,
        name: api.name,
        reason: `API deprecated, removed in ${api.removedInVersion}`,
        severity: "warning",
      });
    }
  }

  for (const chart of input.outdatedCharts) {
    warnings.push({
      kind: "HelmChart",
      name: chart.name,
      reason: `${chart.currentVersion} → ${chart.latestVersion}`,
      severity: "warning",
    });
  }

  const safe = blockers.length === 0;
  const penalty = blockers.length * 30 + warnings.length * 5;
  const readinessScore = Math.max(0, Math.min(100, 100 - penalty));

  return {
    currentVersion: input.currentVersion,
    targetVersion: safe ? input.latestVersion : null,
    safe,
    blockers,
    warnings,
    deprecatedApiCount: input.deprecatedApis.length,
    outdatedChartCount: input.outdatedCharts.length,
    readinessScore,
  };
}
