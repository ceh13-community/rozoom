export type TrivyProviderId = "trivy-operator";
export type TrivyProviderStatus = "installed" | "not_installed" | "error";

export interface TrivyProvider {
  id: TrivyProviderId;
  title: string;
  status: TrivyProviderStatus;
  namespace?: string;
  releaseName?: string;
  chartVersion?: string;
  message: string;
  docsUrl: string;
  githubUrl: string;
}

export interface TrivyHubSummary {
  status: "ok" | "degraded" | "unavailable";
  lastRunAt: string | null;
  message: string;
}

export interface TrivyHubConfig {
  cacheTtlMs: number;
  scheduleMs: number;
}

export interface TrivyHubState {
  summary: TrivyHubSummary;
  providers: TrivyProvider[];
  errors?: string[];
}
