export type BackupStatus = "ok" | "outdated" | "missing" | "failed" | "unverifiable";

export interface BackupMetadata {
  id: string;
  clusterId: string;
  name: string;
  createdAt: string;
  completedAt: string | null;
  phase: string;
  storage: string;
  errors: number;
  warnings: number;
  failureReason?: string;
  validationErrors?: string[];
  ttl?: string;
  includedNamespaces?: string[];
}

export interface BackupRun {
  id: string;
  runAt: string;
  status: BackupStatus;
  reason?: string;
  metadata?: BackupMetadata;
  source: "auto" | "manual" | "connect";
}

export interface BackupSummary {
  status: BackupStatus;
  lastBackupAt: string | null;
  nextDueAt: string | null;
  backupName: string | null;
  source: "velero-cli" | "velero-crd" | "none";
  storage: string | null;
  message: string;
  policyHours: number;
  retentionDays: number;
  errors?: string[];
  warnings?: string[];
}

export interface BackupPolicyConfig {
  maxAgeHours: number;
  retentionDays: number;
  cacheTtlMs: number;
  scheduleMs: number;
  autoCreateEnabled: boolean;
}

export interface ClusterBackupState {
  summary: BackupSummary;
  history: BackupRun[];
}

export type BackupScopeMode = "cluster" | "single" | "multiple";

export interface BackupCreateScope {
  mode: BackupScopeMode;
  namespaces?: string[];
}

export interface BackupCatalogItem {
  name: string;
  createdAt: string;
  phase: string;
  storage: string;
  includedNamespaces: string[];
}
