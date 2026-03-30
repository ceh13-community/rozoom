export type MetricsSourceStatus = "available" | "unreachable" | "not_found";

export interface MetricsSourceEndpoint {
  url: string;
  result: number;
  error?: string;
}

export interface MetricsSourceCheck {
  id: string;
  title: string;
  status: MetricsSourceStatus;
  checkedAt: string;
  message: string;
  endpoints: MetricsSourceEndpoint[];
}

export interface MetricsSourcesSummary {
  status: "ok" | "degraded" | "unavailable";
  lastRunAt: string | null;
  message: string;
}

export interface MetricsSourcesConfig {
  cacheTtlMs: number;
  scheduleMs: number;
  maxNodesToProbe: number;
}

export interface MetricsSourcesState {
  summary: MetricsSourcesSummary;
  checks: MetricsSourceCheck[];
}
