export type YamlBackupScope = "full-cluster" | "selected-namespaces";

export interface YamlBackupRequest {
  clusterId: string;
  clusterName: string;
  scope: YamlBackupScope;
  namespaces?: string[];
  /**
   * When true, Secret resources are included in the export. Off by default so
   * that plaintext credentials do not land in ~/Downloads without an explicit
   * user decision.
   */
  includeSecrets?: boolean;
}

export interface YamlBackupMetadata {
  version: 1;
  timestamp: string;
  clusterName: string;
  clusterId: string;
  scope: YamlBackupScope;
  namespaces: string[];
  resourceTypes: string[];
  files: YamlBackupFileEntry[];
  errors: string[];
}

export interface YamlBackupFileEntry {
  resourceType: string;
  namespace: string | null;
  filename: string;
  itemCount: number;
}

export interface YamlBackupProgress {
  phase: "preparing" | "exporting" | "writing-metadata" | "done" | "error";
  currentResource: string;
  completedResources: number;
  totalResources: number;
  errors: string[];
}

export interface YamlBackupSnapshot {
  path: string;
  timestamp: string;
  clusterName: string;
  metadata: YamlBackupMetadata;
}

export interface YamlRestoreProgress {
  phase: "previewing" | "applying" | "done" | "error";
  currentFile: string;
  completedFiles: number;
  totalFiles: number;
  errors: string[];
  applied: string[];
}

export const NAMESPACED_RESOURCES = [
  "deployments",
  "services",
  "configmaps",
  "statefulsets",
  "daemonsets",
  "jobs",
  "cronjobs",
  "ingresses",
  "persistentvolumeclaims",
  "networkpolicies",
  "serviceaccounts",
  "roles",
  "rolebindings",
] as const;

/**
 * Opt-in only. Added to the backup task list when the user explicitly sets
 * `includeSecrets: true`. See YamlBackupRequest.includeSecrets.
 */
export const SENSITIVE_NAMESPACED_RESOURCES = ["secrets"] as const;

export const CLUSTER_RESOURCES = ["clusterroles", "clusterrolebindings"] as const;

export const RESTORE_ORDER: string[] = [
  "serviceaccounts",
  "configmaps",
  "secrets",
  "persistentvolumeclaims",
  "roles",
  "rolebindings",
  "clusterroles",
  "clusterrolebindings",
  "networkpolicies",
  "services",
  "daemonsets",
  "statefulsets",
  "deployments",
  "jobs",
  "cronjobs",
  "ingresses",
];
