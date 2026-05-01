export type K8sVersionStatus = "ok" | "outdated" | "unsupported" | "unreachable";
export type HelmChartStatus = "up-to-date" | "outdated" | "unknown";

export interface K8sVersionInfo {
  gitVersion: string;
  major: string;
  minor: string;
}

export interface HelmChartInfo {
  name: string;
  namespace: string;
  version: string;
  latest: string | null;
  status: HelmChartStatus;
  repoUrl?: string;
  error?: string;
}

export interface VersionAuditRun {
  id: string;
  runAt: string;
  k8s: {
    version: K8sVersionInfo | null;
    minSupported: string;
    status: K8sVersionStatus;
    message: string;
  };
  charts: HelmChartInfo[];
  outdatedCharts: number;
  source: "auto" | "manual";
  errors?: string[];
}

export interface VersionAuditSummary {
  k8sStatus: K8sVersionStatus;
  k8sVersion: string | null;
  minSupported: string;
  chartStatus: "ok" | "warning" | "unknown";
  outdatedCharts: number;
  totalCharts: number;
  lastRunAt: string | null;
  cacheExpiresAt: string | null;
  message: string;
  errors?: string[];
}

export interface VersionAuditConfig {
  minSupportedVersion: string;
  cacheTtlMs: number;
  scheduleMs: number;
}

export interface ClusterVersionAuditState {
  summary: VersionAuditSummary;
  history: VersionAuditRun[];
}
