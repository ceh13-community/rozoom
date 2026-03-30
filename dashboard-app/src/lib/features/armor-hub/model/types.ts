export type ArmorProviderId = "kubearmor";
export type ArmorProviderStatus = "installed" | "not_installed" | "error";

export interface ArmorProvider {
  id: ArmorProviderId;
  title: string;
  status: ArmorProviderStatus;
  namespace?: string;
  releaseName?: string;
  chartVersion?: string;
  message: string;
  docsUrl: string;
  githubUrl: string;
}

export interface ArmorHubSummary {
  status: "ok" | "degraded" | "unavailable";
  lastRunAt: string | null;
  message: string;
}

export interface ArmorHubConfig {
  cacheTtlMs: number;
  scheduleMs: number;
}

export interface ArmorHubState {
  summary: ArmorHubSummary;
  providers: ArmorProvider[];
  errors?: string[];
}
