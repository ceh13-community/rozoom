export type DeprecationStatus = "ok" | "warning" | "critical" | "unavailable" | "needsConfig";

export type DeprecationIssueStatus = "deprecated" | "removed";

export type DeprecationSource = "cluster" | "helm";
export type DeprecationScope = "observed" | "fullScan" | "helmTemplate";
export type DeprecationTrustLevel = "observed" | "mixed" | "full" | "limited";
export type ScanSourceStatus = "ok" | "warning" | "unavailable";

export interface DeprecationSourceSummary {
  id: DeprecationScope;
  label: string;
  status: ScanSourceStatus;
  findings: number;
  message: string;
}

export interface DeprecationIssue {
  id: string;
  kind: string;
  namespace: string;
  name: string;
  apiVersion: string;
  replacementVersion: string;
  status: DeprecationIssueStatus;
  source: DeprecationSource;
  scope: DeprecationScope;
  requestCount?: number;
  resource?: string;
}

export interface DeprecationScanRun {
  id: string;
  runAt: string;
  targetVersion: string;
  source: "auto" | "manual";
  issues: DeprecationIssue[];
  helmIssues: DeprecationIssue[];
  deprecatedCount: number;
  helmDeprecatedCount: number;
  criticalCount: number;
  status: DeprecationStatus;
  notes: string[];
  errors?: string[];
  trustLevel: DeprecationTrustLevel;
  sourceSummaries: DeprecationSourceSummary[];
}

export interface DeprecationScanSummary {
  status: DeprecationStatus;
  deprecatedCount: number;
  helmDeprecatedCount: number;
  criticalCount: number;
  lastRunAt: string | null;
  targetVersion: string | null;
  clusterVersion: string | null;
  cacheExpiresAt: string | null;
  message: string;
  errors?: string[];
  warnings?: string[];
  trustLevel: DeprecationTrustLevel;
  sourceSummaries: DeprecationSourceSummary[];
}

export interface DeprecationScanConfig {
  targetVersion: string | null;
  cacheTtlMs: number;
  scheduleMs: number;
  enableFullScan: boolean;
  enableHelmScan: boolean;
  usePlutoForFullScan: boolean;
}

export interface ClusterDeprecationScanState {
  summary: DeprecationScanSummary;
  history: DeprecationScanRun[];
}
