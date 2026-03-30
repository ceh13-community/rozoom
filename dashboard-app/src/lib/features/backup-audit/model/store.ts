import { get, writable } from "svelte/store";
import { appDataDir } from "@tauri-apps/api/path";
import { BaseDirectory, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import { execCli } from "$shared/api/cli";
import { getVeleroRelease } from "$shared/api/helm";
import { clusterKey } from "$shared/lib/cluster-key";
import {
  markFeatureCapabilityFromReason,
  shouldSkipFeatureProbe,
} from "$features/check-health/model/feature-capability-cache";
import {
  clusterRuntimeBudget,
  clusterRuntimeContext,
  isClusterRuntimeHeavyDiagnosticsActive,
} from "$shared/lib/cluster-runtime-manager";
import {
  activeDashboardRoute,
  isDashboardFeatureRouteActive,
} from "$shared/lib/dashboard-route-activity";
import { CONFIG_DIR } from "$entities/config/model/appConfig";
import type {
  BackupCatalogItem,
  BackupCreateScope,
  BackupMetadata,
  BackupPolicyConfig,
  BackupRun,
  BackupStatus,
  BackupSummary,
  ClusterBackupState,
} from "./types";

const DEFAULT_CONFIG: BackupPolicyConfig = {
  maxAgeHours: 24,
  retentionDays: 30,
  cacheTtlMs: 10 * 60 * 1000,
  scheduleMs: 15 * 60 * 1000,
  autoCreateEnabled: false,
};

const MAX_HISTORY = 10;
const BACKUP_AUDIT_STORAGE_KEY = "rozoom:backup-audit-state:v1";
const BACKUP_AUDIT_POLICY_STORAGE_KEY = "rozoom:backup-audit-policy:v1";

const DEFAULT_SUMMARY: BackupSummary = {
  status: "unverifiable",
  lastBackupAt: null,
  nextDueAt: null,
  backupName: null,
  source: "none",
  storage: null,
  message: "Backup status unavailable",
  policyHours: DEFAULT_CONFIG.maxAgeHours,
  retentionDays: DEFAULT_CONFIG.retentionDays,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizePolicyConfig(
  raw: Partial<BackupPolicyConfig> | null | undefined,
): BackupPolicyConfig {
  const maxAgeHours = clamp(
    Math.round(raw?.maxAgeHours ?? DEFAULT_CONFIG.maxAgeHours),
    1,
    24 * 365,
  );
  const retentionDays = clamp(
    Math.round(raw?.retentionDays ?? DEFAULT_CONFIG.retentionDays),
    1,
    3650,
  );
  const cacheTtlMs = clamp(
    Math.round(raw?.cacheTtlMs ?? DEFAULT_CONFIG.cacheTtlMs),
    60 * 1000,
    24 * 60 * 60 * 1000,
  );
  const scheduleMs = clamp(
    Math.round(raw?.scheduleMs ?? DEFAULT_CONFIG.scheduleMs),
    60 * 1000,
    24 * 60 * 60 * 1000,
  );
  return {
    maxAgeHours,
    retentionDays,
    cacheTtlMs,
    scheduleMs,
    autoCreateEnabled: raw?.autoCreateEnabled ?? DEFAULT_CONFIG.autoCreateEnabled,
  };
}

function readPersistedBackupPolicyConfig(): BackupPolicyConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(BACKUP_AUDIT_POLICY_STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return DEFAULT_CONFIG;
    return sanitizePolicyConfig(parsed as Partial<BackupPolicyConfig>);
  } catch {
    return DEFAULT_CONFIG;
  }
}

export const backupPolicyConfig = writable<BackupPolicyConfig>(readPersistedBackupPolicyConfig());
function readPersistedBackupAuditState(): Record<string, ClusterBackupState | undefined> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(BACKUP_AUDIT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, ClusterBackupState | undefined>;
  } catch {
    return {};
  }
}

export const backupAuditState = writable<Record<string, ClusterBackupState | undefined>>(
  readPersistedBackupAuditState(),
);

if (typeof window !== "undefined") {
  backupPolicyConfig.subscribe((config) => {
    try {
      window.localStorage.setItem(
        BACKUP_AUDIT_POLICY_STORAGE_KEY,
        JSON.stringify(sanitizePolicyConfig(config)),
      );
    } catch {
      // ignore storage write errors
    }
  });
  backupAuditState.subscribe((state) => {
    try {
      window.localStorage.setItem(BACKUP_AUDIT_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore storage write errors
    }
  });
}

type PollController = {
  refCount: number;
  timer: ReturnType<typeof setInterval> | null;
};

const auditControllers = new Map<string, PollController>();
const autoCreateInFlight = new Set<string>();
const inFlightAudits = new Map<string, Promise<BackupSummary>>();

type VeleroBackupLike = {
  metadata?: {
    uid?: string;
    name?: string;
    creationTimestamp?: string;
  };
  spec?: {
    storageLocation?: string;
    ttl?: string;
    includedNamespaces?: string[];
  };
  status?: {
    phase?: string;
    completionTimestamp?: string;
    errors?: number;
    warnings?: number;
    failureReason?: string;
    validationErrors?: string[] | string;
  };
};

type BackupSource = {
  source: BackupSummary["source"];
  items: VeleroBackupLike[];
  warnings: string[];
  errors: string[];
};

type PodListLike = {
  items?: Array<{ metadata?: { name?: string }; status?: { phase?: string } }>;
};

type NamespaceListLike = {
  items?: Array<{ metadata?: { name?: string } }>;
};

function toIsoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function parseVeleroItems(raw: string): VeleroBackupLike[] {
  try {
    const payload = JSON.parse(raw) as { items?: unknown };
    if (!Array.isArray(payload.items)) return [];
    return payload.items as VeleroBackupLike[];
  } catch {
    return [];
  }
}

function parsePodName(raw: string): string | null {
  try {
    const payload = JSON.parse(raw) as PodListLike;
    const items = payload.items ?? [];
    const running = items.find((item) => item.status?.phase === "Running");
    return running?.metadata?.name ?? items[0]?.metadata?.name ?? null;
  } catch {
    return null;
  }
}

function normalizeVeleroPodExecFallbackMessage(message: string) {
  const normalized = message.trim();
  if (normalized.includes("command terminated with exit code 127")) {
    return `${normalized}. The Velero pod does not expose a runnable 'velero' command in this image/path, so pod-exec fallback is unavailable.`;
  }
  return normalized;
}

function parseNamespaceNames(raw: string): string[] {
  try {
    const payload = JSON.parse(raw) as NamespaceListLike;
    const names = (payload.items ?? [])
      .map((item) => item.metadata?.name?.trim() ?? "")
      .filter(Boolean);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function isValidNamespaceName(value: string): boolean {
  return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value) && value.length <= 63;
}

function normalizeScopeNamespaces(scope?: BackupCreateScope): string[] {
  if (!scope || scope.mode === "cluster") return [];
  const raw = scope.namespaces ?? [];
  const normalized = [...new Set(raw.map((name) => name.trim().toLowerCase()).filter(Boolean))];
  return normalized.filter((name) => isValidNamespaceName(name));
}

async function createBackupViaCrd(
  clusterId: string,
  namespace: string,
  backupName: string,
  ttlHours: number,
  includedNamespaces: string[],
): Promise<{ success: boolean; error?: string }> {
  const safeClusterId = clusterKey(clusterId) || "cluster";
  const manifestRelPath = `${CONFIG_DIR}/velero-backup-${safeClusterId}.yaml`;
  const appLocalDataDirPath = await appDataDir();
  const manifestAbsPath = `${appLocalDataDirPath}/${manifestRelPath}`;
  const includedNamespaceLines =
    includedNamespaces.length > 0 ? includedNamespaces.map((ns) => `  - ${ns}`) : ["  - '*'"];
  const manifest = [
    "apiVersion: velero.io/v1",
    "kind: Backup",
    "metadata:",
    `  name: ${backupName}`,
    `  namespace: ${namespace}`,
    "spec:",
    `  ttl: ${ttlHours}h0m0s`,
    "  includedNamespaces:",
    ...includedNamespaceLines,
  ].join("\n");

  try {
    await writeTextFile(manifestRelPath, `${manifest}\n`, {
      baseDir: BaseDirectory.AppData,
    });

    const applyResult = await kubectlRawArgsFront(["apply", "-f", manifestAbsPath], {
      clusterId,
    });
    if (!applyResult.errors && applyResult.code === 0) {
      return { success: true };
    }
    return {
      success: false,
      error:
        applyResult.errors || applyResult.output || "Failed to apply Velero Backup CRD manifest",
    };
  } finally {
    await remove(manifestRelPath, { baseDir: BaseDirectory.AppData }).catch(() => {});
  }
}

function sanitizeNamespace(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "-");
}

function buildBackupName(): string {
  // RFC1123-compatible k8s resource name: lowercase alnum + '-'
  const iso = new Date().toISOString().toLowerCase();
  const normalized = iso.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `dashboard-manual-${normalized}`;
}

async function resolveKubeconfigPath(clusterId: string): Promise<string> {
  const appLocalDataDirPath = await appDataDir();
  const safeId = clusterKey(clusterId);
  return `${appLocalDataDirPath}/${CONFIG_DIR}/${safeId}.yaml`;
}

const VELERO_BACKUP_FEATURE_ID = "velero-backups";

async function fetchVeleroBackups(
  clusterId: string,
  options?: { force?: boolean },
): Promise<BackupSource> {
  if (
    !options?.force &&
    shouldSkipFeatureProbe(clusterId, VELERO_BACKUP_FEATURE_ID, {
      statuses: ["unsupported", "unreachable"],
    })
  ) {
    return {
      source: "none",
      items: [],
      warnings: [],
      errors: ["Velero backup CRD is not installed on this cluster (cached)"],
    };
  }

  const kubeconfigPath = await resolveKubeconfigPath(clusterId);
  const cliWarnings: string[] = [];
  try {
    const result = await execCli("velero", [
      "backup",
      "get",
      "-o",
      "json",
      "--kubeconfig",
      kubeconfigPath,
    ]);
    if (result.code === 0) {
      return {
        source: "velero-cli",
        items: parseVeleroItems(result.stdout),
        warnings: [],
        errors: [],
      };
    }

    const message = result.stderr.trim() || result.stdout.trim() || "Velero command failed";
    cliWarnings.push(`Velero CLI failed: ${message}. Falling back to backups.velero.io CRD.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Velero command failed";
    cliWarnings.push(`Velero CLI failed: ${message}. Falling back to backups.velero.io CRD.`);
  }

  const fallback = await kubectlRawArgsFront(["get", "backups.velero.io", "-A", "-o", "json"], {
    clusterId,
  });
  if (!fallback.errors && fallback.code === 0) {
    return {
      source: "velero-crd",
      items: parseVeleroItems(fallback.output),
      warnings:
        cliWarnings.length > 0
          ? cliWarnings
          : ["Velero CLI unavailable; using Kubernetes CRD fallback."],
      errors: [],
    };
  }

  const fallbackError = fallback.errors || "Unable to load Velero backups via CRD API";
  markFeatureCapabilityFromReason(clusterId, VELERO_BACKUP_FEATURE_ID, fallbackError);
  return {
    source: "none",
    items: [],
    warnings: cliWarnings,
    errors: [
      "Failed to read Velero backups from both CLI and backups.velero.io CRD.",
      fallbackError,
    ],
  };
}

function metadataTimestamp(metadata: BackupMetadata): number {
  const ref = metadata.completedAt ?? metadata.createdAt;
  return new Date(ref).getTime();
}

function mapVeleroMetadata(clusterId: string, item: VeleroBackupLike): BackupMetadata | null {
  const name = item.metadata?.name ?? "";
  const createdAt = toIsoOrNull(item.metadata?.creationTimestamp);
  if (!name || !createdAt) return null;

  return {
    id: item.metadata?.uid || `${clusterId}-${name}`,
    clusterId,
    name,
    createdAt,
    completedAt: toIsoOrNull(item.status?.completionTimestamp),
    phase: item.status?.phase || "Unknown",
    storage: item.spec?.storageLocation || "default",
    errors: toNumber(item.status?.errors),
    warnings: toNumber(item.status?.warnings),
    failureReason:
      typeof item.status?.failureReason === "string" && item.status.failureReason.trim()
        ? item.status.failureReason.trim()
        : undefined,
    validationErrors: toStringList(item.status?.validationErrors),
    ttl: item.spec?.ttl,
    includedNamespaces: toStringList(item.spec?.includedNamespaces),
  };
}

function deriveStatus(metadata: BackupMetadata | null, config: BackupPolicyConfig): BackupStatus {
  if (!metadata) return "missing";

  const phase = metadata.phase.toLowerCase();
  if (phase.includes("failed")) return "failed";

  const ageMs = Date.now() - metadataTimestamp(metadata);
  const maxAgeMs = config.maxAgeHours * 60 * 60 * 1000;
  if (ageMs > maxAgeMs) return "outdated";
  return "ok";
}

function buildSummary(
  metadata: BackupMetadata | null,
  status: BackupStatus,
  config: BackupPolicyConfig,
  source: BackupSummary["source"],
  errors: string[],
  warnings: string[],
): BackupSummary {
  const lastBackupAt = metadata?.completedAt ?? metadata?.createdAt ?? null;
  const nextDueAt = lastBackupAt
    ? new Date(new Date(lastBackupAt).getTime() + config.maxAgeHours * 60 * 60 * 1000).toISOString()
    : null;

  const phaseSuffix = metadata ? ` · ${metadata.phase}` : "";
  let detail = "";
  if (metadata) {
    const detailText =
      metadata.failureReason ||
      metadata.validationErrors?.[0] ||
      (metadata.errors > 0 ? `${metadata.errors} errors` : "");
    if (detailText) {
      detail = ` · ${detailText}`;
    }
  }
  const statusMessage: Record<BackupStatus, string> = {
    ok: `Latest backup is fresh${phaseSuffix}`,
    outdated: `Latest backup is older than ${config.maxAgeHours}h${phaseSuffix}`,
    missing: "No Velero backups were found",
    failed: `Latest backup failed${phaseSuffix}${detail}`,
    unverifiable: "Unable to verify backup status",
  };

  const missingVeleroCrd = errors.some((entry) => {
    const normalized = entry.toLowerCase();
    return (
      normalized.includes('resource type "backups"') ||
      normalized.includes("backups.velero.io crd") ||
      normalized.includes("could not find the requested resource")
    );
  });

  return {
    status,
    lastBackupAt,
    nextDueAt,
    backupName: metadata?.name ?? null,
    source,
    storage: metadata?.storage ?? null,
    message:
      status === "unverifiable" && missingVeleroCrd
        ? "Velero backup CRD is not installed on this cluster"
        : statusMessage[status],
    policyHours: config.maxAgeHours,
    retentionDays: config.retentionDays,
    errors: errors.length ? errors : undefined,
    warnings: warnings.length ? warnings : undefined,
  };
}

function ensureState(config: BackupPolicyConfig, message: string): ClusterBackupState {
  return {
    summary: {
      ...DEFAULT_SUMMARY,
      message,
      policyHours: config.maxAgeHours,
      retentionDays: config.retentionDays,
      source: "none",
      errors: [message],
    },
    history: [],
  };
}

export async function runBackupAudit(
  clusterId: string,
  options?: { force?: boolean; source?: BackupRun["source"] },
): Promise<BackupSummary> {
  const inFlight = inFlightAudits.get(clusterId);
  if (inFlight) {
    return inFlight;
  }

  const runPromise = (async () => {
    const config = get(backupPolicyConfig);
    const currentState = get(backupAuditState)[clusterId];
    const lastRunAt = currentState?.history[0]?.runAt;

    if (lastRunAt && !options?.force) {
      const cachedUntil = new Date(lastRunAt).getTime() + config.cacheTtlMs;
      if (Date.now() < cachedUntil) {
        return currentState.summary;
      }
    }

    const source = await fetchVeleroBackups(clusterId, { force: options?.force });
    const metadata = source.items
      .map((item) => mapVeleroMetadata(clusterId, item))
      .filter((value): value is BackupMetadata => value !== null)
      .sort((a, b) => metadataTimestamp(b) - metadataTimestamp(a));
    const latest = metadata.at(0);

    const status: BackupStatus =
      source.source === "none" ? "unverifiable" : deriveStatus(latest ?? null, config);
    const summary = buildSummary(
      latest ?? null,
      status,
      config,
      source.source,
      source.errors,
      source.warnings,
    );
    const runAt = new Date().toISOString();
    const run: BackupRun = {
      id: `${clusterId}-${runAt}`,
      runAt,
      status,
      reason: source.errors[0],
      metadata: latest,
      source: options?.source ?? "auto",
    };
    const nextHistory = [run, ...(currentState?.history ?? [])].slice(0, MAX_HISTORY);

    backupAuditState.update((state) => ({
      ...state,
      [clusterId]: {
        summary,
        history: nextHistory,
      },
    }));

    return summary;
  })().finally(() => {
    if (inFlightAudits.get(clusterId) === runPromise) {
      inFlightAudits.delete(clusterId);
    }
  });

  inFlightAudits.set(clusterId, runPromise);
  return runPromise;
}

export async function listClusterNamespaces(clusterId: string): Promise<string[]> {
  const result = await kubectlRawArgsFront(["get", "namespaces", "-o", "json"], { clusterId });
  if (result.errors || result.code !== 0) {
    throw new Error(result.errors || result.output || "Failed to load namespaces");
  }
  return parseNamespaceNames(result.output);
}

export async function scanRestoreBackups(clusterId: string): Promise<BackupCatalogItem[]> {
  const source = await fetchVeleroBackups(clusterId, { force: true });
  if (source.source === "none") {
    throw new Error(source.errors[0] || "Failed to load backups for restore");
  }

  return source.items
    .map((item) => mapVeleroMetadata(clusterId, item))
    .filter((value): value is BackupMetadata => value !== null)
    .sort((a, b) => metadataTimestamp(b) - metadataTimestamp(a))
    .map((metadata) => ({
      name: metadata.name,
      createdAt: metadata.createdAt,
      phase: metadata.phase,
      storage: metadata.storage,
      includedNamespaces: metadata.includedNamespaces ?? [],
    }));
}

export async function createBackupNow(
  clusterId: string,
  options?: { scope?: BackupCreateScope },
): Promise<BackupSummary> {
  const config = get(backupPolicyConfig);
  const kubeconfigPath = await resolveKubeconfigPath(clusterId);
  const backupName = buildBackupName();
  const ttlHours = Math.max(1, config.retentionDays * 24);
  const selectedNamespaces = normalizeScopeNamespaces(options?.scope);
  const includeNamespacesArg = selectedNamespaces.length > 0 ? selectedNamespaces.join(",") : null;
  const createArgs = [
    "backup",
    "create",
    backupName,
    "--ttl",
    `${ttlHours}h0m0s`,
    "--kubeconfig",
    kubeconfigPath,
  ];
  if (includeNamespacesArg) {
    createArgs.push("--include-namespaces", includeNamespacesArg);
  }
  let result: { code: number; stdout: string; stderr: string };
  try {
    result = await execCli("velero", createArgs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result = {
      code: 1,
      stdout: "",
      stderr: message || "Velero command failed",
    };
  }

  if (result.code !== 0) {
    const message =
      result.stderr.trim() || result.stdout.trim() || "Failed to create backup with Velero";

    const release = await getVeleroRelease(clusterId);
    const targetNamespace = release.release?.namespace || "velero";
    const crdFallback = await createBackupViaCrd(
      clusterId,
      targetNamespace,
      backupName,
      ttlHours,
      selectedNamespaces,
    );
    if (crdFallback.success) {
      return runBackupAudit(clusterId, { force: true, source: "manual" });
    }

    const releaseName = release.release?.name || "velero";
    const selectors = [
      `app.kubernetes.io/instance=${releaseName}`,
      "app.kubernetes.io/name=velero",
      "component=velero",
      "name=velero",
    ];
    let podName: string | null = null;
    let podsMessage: string | null = null;
    for (const selector of selectors) {
      const podsResult = await kubectlRawArgsFront(
        ["get", "pods", "-n", targetNamespace, "-l", selector, "-o", "json"],
        { clusterId },
      );
      if (podsResult.errors || podsResult.code !== 0) {
        podsMessage = podsResult.errors || "Failed to list Velero pods";
        continue;
      }
      podName = parsePodName(podsResult.output || "");
      if (podName) break;
    }

    if (podName) {
      const fallbackExec = await kubectlRawArgsFront(
        (() => {
          const args = [
            "exec",
            "-n",
            targetNamespace,
            podName,
            "--",
            "velero",
            "backup",
            "create",
            backupName,
            "--ttl",
            `${ttlHours}h0m0s`,
          ];
          if (includeNamespacesArg) {
            args.push("--include-namespaces", includeNamespacesArg);
          }
          return args;
        })(),
        {
          clusterId,
        },
      );
      if (!fallbackExec.errors && fallbackExec.code === 0) {
        return runBackupAudit(clusterId, { force: true, source: "manual" });
      }
      const fallbackMessage = normalizeVeleroPodExecFallbackMessage(
        fallbackExec.errors || fallbackExec.output || "kubectl exec velero fallback failed",
      );
      throw new Error(
        `Velero CLI failed: ${message}. CRD fallback failed: ${crdFallback.error || "unknown error"}. Pod-exec fallback failed: ${fallbackMessage}`,
      );
    }

    throw new Error(
      `Velero CLI failed: ${message}. CRD fallback failed: ${crdFallback.error || "unknown error"}. ${podsMessage || "Velero pod not found for fallback"}`,
    );
  }

  return runBackupAudit(clusterId, { force: true, source: "manual" });
}

export async function restoreNamespaceFromBackup(
  clusterId: string,
  options: {
    backupName: string;
    sourceNamespace: string;
    targetNamespace: string;
  },
): Promise<void> {
  const backupName = options.backupName.trim();
  const sourceNamespace = sanitizeNamespace(options.sourceNamespace);
  const targetNamespace = sanitizeNamespace(options.targetNamespace);
  if (!backupName) throw new Error("Backup name is required");
  if (!sourceNamespace) throw new Error("Source namespace is required");
  if (!targetNamespace) throw new Error("Target namespace is required");

  const release = await getVeleroRelease(clusterId);
  const veleroNamespace = release.release?.namespace || "velero";
  const restoreName = `dashboard-restore-${Date.now()}`;
  const safeClusterId = clusterKey(clusterId) || "cluster";
  const manifestRelPath = `${CONFIG_DIR}/velero-restore-${safeClusterId}.yaml`;
  const appLocalDataDirPath = await appDataDir();
  const manifestAbsPath = `${appLocalDataDirPath}/${manifestRelPath}`;
  const manifest = [
    "apiVersion: velero.io/v1",
    "kind: Restore",
    "metadata:",
    `  name: ${restoreName}`,
    `  namespace: ${veleroNamespace}`,
    "spec:",
    `  backupName: ${backupName}`,
    "  includedNamespaces:",
    `  - ${sourceNamespace}`,
    "  namespaceMapping:",
    `    ${sourceNamespace}: ${targetNamespace}`,
  ].join("\n");

  try {
    await writeTextFile(manifestRelPath, `${manifest}\n`, {
      baseDir: BaseDirectory.AppData,
    });
    const applyResult = await kubectlRawArgsFront(["apply", "-f", manifestAbsPath], {
      clusterId,
    });
    if (applyResult.errors || applyResult.code !== 0) {
      throw new Error(
        applyResult.errors || applyResult.output || "Failed to create Velero Restore",
      );
    }
  } finally {
    await remove(manifestRelPath, { baseDir: BaseDirectory.AppData }).catch(() => {});
  }
}

export function startBackupAuditPolling(clusterId: string) {
  if (!clusterId) return;

  const existing = auditControllers.get(clusterId);
  if (existing) {
    existing.refCount += 1;
    ensureBackupAuditPolling(clusterId, existing);
    return;
  }

  const controller: PollController = { refCount: 1, timer: null };
  auditControllers.set(clusterId, controller);
  ensureBackupAuditPolling(clusterId, controller);
}

function runBackupAuditCycle(clusterId: string, source: BackupRun["source"]) {
  return (async () => {
    try {
      const summary = await runBackupAudit(clusterId, { source });
      const config = get(backupPolicyConfig);
      if (!config.autoCreateEnabled) return;
      if (summary.status === "ok") return;
      if (autoCreateInFlight.has(clusterId)) return;
      const release = await getVeleroRelease(clusterId);
      if (!release.installed) return;

      autoCreateInFlight.add(clusterId);
      try {
        await createBackupNow(clusterId, {
          scope: { mode: "cluster" },
        });
      } finally {
        autoCreateInFlight.delete(clusterId);
      }
    } catch {
      // Keep polling alive even when single run fails.
    }
  })();
}

export function stopBackupAuditPolling(clusterId: string) {
  const controller = auditControllers.get(clusterId);
  if (!controller) return;
  controller.refCount -= 1;
  if (controller.refCount > 0) return;
  stopBackupAuditTimer(controller);
  auditControllers.delete(clusterId);
}

export function stopAllBackupAuditPolling() {
  for (const [clusterId, controller] of auditControllers.entries()) {
    stopBackupAuditTimer(controller);
    auditControllers.delete(clusterId);
  }
}

function stopBackupAuditTimer(controller: PollController) {
  if (!controller.timer) return;
  clearInterval(controller.timer);
  controller.timer = null;
}

function ensureBackupAuditPolling(clusterId: string, controller: PollController) {
  if (controller.timer || controller.refCount <= 0) return;
  if (!isClusterRuntimeHeavyDiagnosticsActive(clusterId)) return;
  if (
    !isDashboardFeatureRouteActive(clusterId, {
      dashboardRoot: true,
      workloads: ["backupaudit"],
    })
  ) {
    return;
  }

  void runBackupAuditCycle(clusterId, "connect");
  const { scheduleMs } = get(backupPolicyConfig);
  controller.timer = setInterval(() => {
    void runBackupAuditCycle(clusterId, "auto");
  }, scheduleMs);
}

function syncBackupAuditPolling(clusterId: string, controller: PollController) {
  if (
    isClusterRuntimeHeavyDiagnosticsActive(clusterId) &&
    isDashboardFeatureRouteActive(clusterId, {
      dashboardRoot: true,
      workloads: ["backupaudit"],
    })
  ) {
    ensureBackupAuditPolling(clusterId, controller);
    return;
  }
  stopBackupAuditTimer(controller);
}

clusterRuntimeContext.subscribe(() => {
  for (const [clusterId, controller] of auditControllers.entries()) {
    syncBackupAuditPolling(clusterId, controller);
  }
});

clusterRuntimeBudget.subscribe(() => {
  for (const [clusterId, controller] of auditControllers.entries()) {
    syncBackupAuditPolling(clusterId, controller);
  }
});

activeDashboardRoute.subscribe(() => {
  for (const [clusterId, controller] of auditControllers.entries()) {
    syncBackupAuditPolling(clusterId, controller);
  }
});

export function markBackupAuditUnavailable(clusterId: string, reason: string) {
  const config = get(backupPolicyConfig);
  const nextState = ensureState(config, reason);

  backupAuditState.update((state) => ({
    ...state,
    [clusterId]: nextState,
  }));
}
