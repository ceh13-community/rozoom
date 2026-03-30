export type ComplianceProviderId = "kubescape" | "kube-bench";
export type ComplianceProviderStatus = "installed" | "not_installed" | "error";
export type ComplianceFindingSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface ComplianceControlSummary {
  id: string;
  desc?: string;
  pass: number;
  fail: number;
  warn: number;
  info: number;
}

export interface ComplianceFindingTotals {
  pass: number;
  fail: number;
  warn: number;
  info: number;
}

export interface ComplianceFindingDetails {
  controls?: ComplianceControlSummary[];
  totals?: ComplianceFindingTotals;
}

export interface ComplianceProvider {
  id: ComplianceProviderId;
  title: string;
  status: ComplianceProviderStatus;
  namespace?: string;
  releaseName?: string;
  chartVersion?: string;
  message: string;
}

export interface ComplianceFinding {
  id: string;
  provider: ComplianceProviderId;
  severity: ComplianceFindingSeverity;
  framework?: string;
  control?: string;
  resource?: string;
  namespace?: string;
  phase?: string;
  message: string;
  details?: ComplianceFindingDetails;
  updatedAt: string;
}

export interface ComplianceHubSummary {
  status: "ok" | "degraded" | "unavailable";
  lastRunAt: string | null;
  message: string;
}

export interface ComplianceHubConfig {
  cacheTtlMs: number;
  scheduleMs: number;
}

export interface ComplianceHubState {
  summary: ComplianceHubSummary;
  providers: ComplianceProvider[];
  findings: ComplianceFinding[];
  errors?: string[];
}
