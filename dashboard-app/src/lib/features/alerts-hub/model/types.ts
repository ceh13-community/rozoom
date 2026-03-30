export type AlertState = "firing" | "pending" | "silenced" | "inhibited";
export type AlertSource = "alertmanager" | "prometheus" | "events";
export type AlertSeverity = "page" | "warn" | "info" | "unknown";

export interface AlertItem {
  id: string;
  state: AlertState;
  severity: AlertSeverity;
  alertname: string;
  since: string;
  namespace?: string;
  pod?: string;
  node?: string;
  receiver?: string;
  summary?: string;
  description?: string;
  runbookUrl?: string;
  source: AlertSource;
  silenceId?: string;
  silenceEndsAt?: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

export interface AlertSilenceRequest {
  alertname: string;
  namespace?: string;
  durationHours: number;
  author: string;
  comment: string;
}

export interface AlertHubSummary {
  status: "ok" | "degraded" | "unavailable";
  lastRunAt: string | null;
  source: AlertSource | "none";
  message: string;
  alertmanagerLastSuccessAt: string | null;
  alertmanagerLastError: string | null;
}

export interface AlertHubConfig {
  cacheTtlMs: number;
  scheduleMs: number;
}

export interface AlertHubState {
  summary: AlertHubSummary;
  alerts: AlertItem[];
  errors?: string[];
}
