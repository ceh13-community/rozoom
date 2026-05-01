<script lang="ts">
  import { onMount } from "svelte";
  import {
    dashboardDataProfile,
    shouldAutoRunDiagnostics,
  } from "$shared/lib/dashboard-data-profile.svelte";
  import { BaseDirectory, mkdir, writeTextFile } from "@tauri-apps/plugin-fs";
  import {
    backupAuditState,
    scanRestoreBackups,
    backupPolicyConfig,
    createBackupNow,
    listClusterNamespaces,
    markBackupAuditUnavailable,
    readVeleroInstallProfile,
    restoreNamespaceFromBackup,
    runBackupAudit,
    startBackupAuditPolling,
    stopBackupAuditPolling,
    type BackupCatalogItem,
    type BackupRun,
    type BackupScopeMode,
    writeVeleroInstallProfile,
  } from "$features/backup-audit";
  import { humanizeVeleroError } from "$features/backup-audit/model/humanize";
  import {
    getVeleroRelease,
    installVelero,
    type HelmListedRelease,
    type VeleroCloudProvider,
  } from "$shared/api/helm";
  import { execCliForCluster } from "$shared/api/cli";
  import { confirmAction } from "$shared/lib/confirm-action";
  import * as Card from "$shared/ui/card";
  import { Badge } from "$shared/ui/badge";
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import * as Select from "$shared/ui/select";
  import * as Table from "$shared/ui/table";
  import { Clock4, Info, Refresh } from "$shared/ui/icons";
  import * as Alert from "$shared/ui/alert";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";
  import DiagnosticSummaryCard from "$shared/ui/diagnostic-summary-card.svelte";
  import { CommandConsole, createConsoleSession } from "$shared/ui/command-console";

  interface Props {
    clusterId: string;
    offline?: boolean;
  }

  const { clusterId, offline = false }: Props = $props();

  const auditState = $derived($backupAuditState[clusterId]);
  const summary = $derived(auditState?.summary ?? null);
  const history = $derived(auditState?.history ?? []);
  const latestRun = $derived(history[0] ?? null);
  const config = $derived($backupPolicyConfig);
  let actionMessage = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let helmActionError = $state<string | null>(null);
  let helmActionMessage = $state<string | null>(null);
  const veleroInstallSession = createConsoleSession();
  let checking = $state(false);
  let creating = $state(false);
  let veleroLoading = $state(false);
  let veleroInstalling = $state(false);
  let veleroRelease = $state<HelmListedRelease | null>(null);
  let veleroError = $state<string | null>(null);
  let veleroNamespaceDraft = $state("velero");
  let provider = $state<VeleroCloudProvider>("aws");
  let bucket = $state("");
  let region = $state("");
  let s3Url = $state("");
  let forcePathStyle = $state(true);
  let awsIamRoleArn = $state("");
  let awsAccessKeyId = $state("");
  let awsSecretAccessKey = $state("");
  let azureResourceGroup = $state("");
  let azureStorageAccount = $state("");
  let azureSubscriptionId = $state("");
  let azureStorageAccountUri = $state("");
  let azureCloudName = $state("AzurePublicCloud");
  let azureClientId = $state("");
  let azureClientSecret = $state("");
  let azureTenantId = $state("");
  let gcpProject = $state("");
  let gcpServiceAccount = $state("");
  let gcpCredentialsJson = $state("");
  let doAccessKey = $state("");
  let doSecretKey = $state("");
  let restoring = $state(false);
  let pageVisible = $state(true);
  let restoreBackupName = $state("");
  let restoreSourceNamespace = $state("default");
  let restoreTargetNamespace = $state("default");
  let restoreBackups = $state<BackupCatalogItem[]>([]);
  let restoreScanLoading = $state(false);
  let restoreScanError = $state<string | null>(null);
  let policyMaxAgeHours = $state(24);
  let policyRetentionDays = $state(30);
  let policyCacheTtlMinutes = $state(10);
  let policyAutoCreateEnabled = $state(false);
  let policySaving = $state(false);
  let policyError = $state<string | null>(null);
  let policyMessage = $state<string | null>(null);
  let backupScopeMode = $state<BackupScopeMode>("cluster");
  let namespaceLoading = $state(false);
  let namespaceError = $state<string | null>(null);
  let availableNamespaces = $state<string[]>([]);
  let selectedNamespace = $state("");
  let selectedNamespaces = $state<string[]>([]);
  let credentialsTestResult = $state<{ ok: boolean; message: string } | null>(null);
  let credentialsTesting = $state(false);
  let restorePreview = $state<{
    backupName: string;
    sourceNs: string;
    targetNs: string;
    describe: string;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const autoDiagnosticsEnabled = $derived(shouldAutoRunDiagnostics($dashboardDataProfile));

  const backupFreshness = $derived.by<{
    ageHours: number | null;
    percent: number;
    severity: "ok" | "warning" | "critical";
  }>(() => {
    const lastIso = summary?.lastBackupAt;
    if (!lastIso) return { ageHours: null, percent: 0, severity: "critical" };
    const last = Date.parse(lastIso);
    if (Number.isNaN(last)) return { ageHours: null, percent: 0, severity: "critical" };
    const ageHours = (Date.now() - last) / 3_600_000;
    const maxAge = Math.max(1, policyMaxAgeHours);
    const percent = Math.min(1, ageHours / maxAge);
    let sev: "ok" | "warning" | "critical" = "ok";
    if (percent >= 1) sev = "critical";
    else if (percent >= 0.75) sev = "warning";
    return { ageHours, percent, severity: sev };
  });

  const statusStyles: Record<string, string> = {
    ok: "bg-emerald-500",
    outdated: "bg-amber-500",
    missing: "bg-rose-600",
    failed: "bg-rose-600",
    unverifiable: "bg-slate-500",
  };

  const providerOptions: Array<{ value: VeleroCloudProvider; label: string }> = [
    { value: "aws", label: "AWS" },
    { value: "azure", label: "Azure" },
    { value: "gcp", label: "GKE (GCP)" },
    { value: "do", label: "DigitalOcean (Spaces)" },
    { value: "hetzner", label: "Hetzner (Object Storage)" },
  ];

  const providerHints: Record<VeleroCloudProvider, string> = {
    aws: "AWS S3 + EBS snapshots. Auth: IRSA role ARN or static keys.",
    azure:
      "Azure Blob + Azure snapshots. Current flow uses service principal credentials (client id/secret/tenant/subscription).",
    gcp: "GCS + GCE snapshots. For GKE use workload identity service account or service-account JSON.",
    do: "DigitalOcean Spaces in S3-compatible mode (object backups). Volume snapshots are disabled.",
    hetzner:
      "Hetzner Object Storage (S3-compatible). Uses AWS Velero plugin with custom endpoint. Volume snapshots are disabled.",
  };

  const showS3Inputs = $derived(provider === "aws" || provider === "do" || provider === "hetzner");
  const showAwsAuth = $derived(provider === "aws");
  const showDoAuth = $derived(provider === "do" || provider === "hetzner");
  const showAzureInputs = $derived(provider === "azure");
  const showGcpInputs = $derived(provider === "gcp");
  const hasVeleroInstalled = $derived(Boolean(veleroRelease));

  function formatDate(value: string | null) {
    if (!value) return "-";
    return new Date(value).toLocaleString();
  }

  function formatDuration(hours: number) {
    return `${hours}h`;
  }

  function formatRelativeAge(iso: string | null): string {
    if (!iso) return "-";
    const ts = Date.parse(iso);
    if (Number.isNaN(ts)) return "-";
    const diffMs = Date.now() - ts;
    const min = Math.round(diffMs / 60_000);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 48) return `${hr}h ago`;
    return `${Math.round(hr / 24)}d ago`;
  }

  function formatRunDuration(run: BackupRun): string {
    const start = run.metadata?.createdAt ?? run.runAt;
    const end = run.metadata?.completedAt ?? null;
    if (!start || !end) return "-";
    const diffMs = Date.parse(end) - Date.parse(start);
    if (!Number.isFinite(diffMs) || diffMs <= 0) return "-";
    if (diffMs < 60_000) return `${Math.round(diffMs / 1000)}s`;
    return `${Math.round(diffMs / 60_000)}m`;
  }

  function normalizePositiveInt(value: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    const rounded = Math.round(value);
    return rounded > 0 ? rounded : fallback;
  }

  function formatRunScope(run: BackupRun): string {
    const included = run.metadata?.includedNamespaces ?? [];
    if (included.length === 0 || included.includes("*")) return "Full Cluster";
    if (included.length <= 2) return included.join(", ");
    return `${included.length} namespaces`;
  }

  function getRestoreSourceOptions(backupName: string): string[] {
    const selectedBackup = restoreBackups.find((item) => item.name === backupName);
    const included = selectedBackup?.includedNamespaces ?? [];
    if (included.length === 0 || included.includes("*")) {
      return availableNamespaces;
    }
    return included;
  }

  function syncRestoreSourceFromSelection() {
    const sourceOptions = getRestoreSourceOptions(restoreBackupName);
    if (!sourceOptions.includes(restoreSourceNamespace)) {
      restoreSourceNamespace = sourceOptions[0] ?? "";
    }
  }

  function veleroChartVersion(chart: string | undefined): string {
    if (!chart) return "unknown";
    const match = chart.match(/-(\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?)$/);
    return match?.[1] ?? "unknown";
  }

  function sanitizePathPart(value: string) {
    return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
  }

  async function loadVeleroProfile() {
    const profile = await readVeleroInstallProfile(clusterId);
    veleroNamespaceDraft = profile.namespace || "velero";
    provider = profile.provider || "aws";
    bucket = profile.bucket || "";
    region = profile.region || "";
    s3Url = profile.s3Url || "";
    forcePathStyle = profile.forcePathStyle ?? true;
    awsIamRoleArn = profile.awsIamRoleArn || "";
    azureResourceGroup = profile.azureResourceGroup || "";
    azureStorageAccount = profile.azureStorageAccount || "";
    azureSubscriptionId = profile.azureSubscriptionId || "";
    azureStorageAccountUri = profile.azureStorageAccountUri || "";
    azureCloudName = profile.azureCloudName || "AzurePublicCloud";
    gcpProject = profile.gcpProject || "";
    gcpServiceAccount = profile.gcpServiceAccount || "";
  }

  async function refreshVeleroStatus() {
    if (!clusterId) return;
    veleroLoading = true;
    veleroError = null;
    try {
      const release = await getVeleroRelease(clusterId);
      if (release.error) {
        veleroRelease = null;
        veleroError = release.error;
        availableNamespaces = [];
        selectedNamespace = "";
        selectedNamespaces = [];
        restoreBackups = [];
        restoreBackupName = "";
        restoreSourceNamespace = "";
        return;
      }
      veleroRelease = release.release ?? null;
      if (veleroRelease) {
        await loadNamespaces();
        await scanBackupsForRestore();
      } else {
        availableNamespaces = [];
        selectedNamespace = "";
        selectedNamespaces = [];
        restoreBackups = [];
        restoreBackupName = "";
        restoreSourceNamespace = "";
      }
    } catch (error) {
      veleroRelease = null;
      veleroError = error instanceof Error ? error.message : "Failed to check Velero Helm release";
    } finally {
      veleroLoading = false;
    }
  }

  async function loadNamespaces() {
    if (!clusterId) return;
    namespaceLoading = true;
    namespaceError = null;
    try {
      const namespaces = await listClusterNamespaces(clusterId);
      availableNamespaces = namespaces;

      if (!availableNamespaces.includes(selectedNamespace)) {
        selectedNamespace = availableNamespaces[0] ?? "";
      }
      selectedNamespaces = selectedNamespaces.filter((item) => availableNamespaces.includes(item));
      syncRestoreSourceFromSelection();
    } catch (error) {
      availableNamespaces = [];
      selectedNamespace = "";
      selectedNamespaces = [];
      syncRestoreSourceFromSelection();
      namespaceError = error instanceof Error ? error.message : "Failed to load namespaces";
    } finally {
      namespaceLoading = false;
    }
  }

  async function installVeleroWithHelm() {
    if (!clusterId || veleroInstalling || veleroLoading) return;
    veleroInstalling = true;
    helmActionError = null;
    helmActionMessage = null;
    veleroError = null;
    veleroInstallSession.start();
    try {
      const profile = await writeVeleroInstallProfile(clusterId, {
        namespace: veleroNamespaceDraft,
        provider,
        bucket,
        region,
        s3Url,
        forcePathStyle,
        awsIamRoleArn,
        azureResourceGroup,
        azureStorageAccount,
        azureSubscriptionId,
        azureStorageAccountUri,
        azureCloudName,
        gcpProject,
        gcpServiceAccount,
      });
      veleroNamespaceDraft = profile.namespace;

      if (provider === "aws") {
        if (!bucket.trim() || !region.trim()) {
          throw new Error("For AWS install, both S3 bucket and region are required.");
        }
        const hasAccessKeys = Boolean(awsAccessKeyId.trim() && awsSecretAccessKey.trim());
        const hasIamRole = Boolean(awsIamRoleArn.trim());
        if (!hasAccessKeys && !hasIamRole) {
          throw new Error("Provide either AWS access keys or IAM Role ARN (IRSA) for Velero.");
        }
      }
      if (provider === "do" || provider === "hetzner") {
        const providerLabel =
          provider === "hetzner" ? "Hetzner Object Storage" : "DigitalOcean Spaces";
        if (!bucket.trim() || !region.trim() || !s3Url.trim()) {
          throw new Error(`For ${providerLabel}, provide bucket, region, and endpoint URL.`);
        }
        const hasDoKeys = Boolean(doAccessKey.trim() && doSecretKey.trim());
        if (!hasDoKeys) {
          throw new Error(`For ${providerLabel}, provide access key and secret key.`);
        }
      }
      if (provider === "azure") {
        if (!bucket.trim() || !azureResourceGroup.trim() || !azureStorageAccount.trim()) {
          throw new Error(
            "For Azure install, provide blob container, resource group, and storage account.",
          );
        }
        const hasAzureCreds = Boolean(
          azureClientId.trim() &&
            azureClientSecret.trim() &&
            azureTenantId.trim() &&
            azureSubscriptionId.trim(),
        );
        if (!hasAzureCreds) {
          throw new Error(
            "For Azure install, provide client id, client secret, tenant id, and subscription id.",
          );
        }
      }
      if (provider === "gcp" && !bucket.trim()) {
        throw new Error("For CKE/GKE install, provide GCS bucket.");
      }

      const result = await installVelero(
        clusterId,
        profile.namespace,
        {
          provider,
          bucket,
          region,
          s3Url,
          forcePathStyle,
          awsIamRoleArn,
          awsAccessKeyId:
            provider === "do" || provider === "hetzner" ? doAccessKey : awsAccessKeyId,
          awsSecretAccessKey:
            provider === "do" || provider === "hetzner" ? doSecretKey : awsSecretAccessKey,
          azureResourceGroup,
          azureStorageAccount,
          azureSubscriptionId,
          azureStorageAccountUri,
          azureCloudName,
          azureClientId,
          azureClientSecret,
          azureTenantId,
          gcpProject,
          gcpServiceAccount,
          gcpCredentialsJson,
        },
        (chunk) => veleroInstallSession.append(chunk),
      );
      if (!result.success) {
        const message = result.error ?? "Failed to install Velero with Helm";
        if (
          message.includes("BackupStorageLocation.velero.io") ||
          message.includes("VolumeSnapshotLocation.velero.io")
        ) {
          throw new Error(
            "Velero chart requires storage provider configuration (BSL/VSL). Secrets are not stored locally; configure provider values/credentials in-cluster and retry.",
          );
        }
        throw new Error(message);
      }
      await refreshVeleroStatus();
      await runBackupAudit(clusterId, { force: true, source: "manual" });
      helmActionMessage = `Velero Helm release is installed in namespace ${profile.namespace}.`;
      veleroInstallSession.succeed();
    } catch (error) {
      helmActionError =
        error instanceof Error ? error.message : "Failed to install Velero with Helm";
      veleroInstallSession.fail();
    } finally {
      veleroInstalling = false;
    }
  }

  async function runNow() {
    if (checking || creating) return;
    checking = true;
    actionError = null;
    actionMessage = null;
    try {
      await runBackupAudit(clusterId, { force: true, source: "manual" });
      actionMessage = `Backup status refreshed at ${new Date().toLocaleTimeString()}`;
    } catch (error) {
      actionError = error instanceof Error ? error.message : "Failed to check backup status";
    } finally {
      checking = false;
    }
  }

  async function createBackup() {
    if (checking || creating) return;
    creating = true;
    actionError = null;
    actionMessage = null;
    try {
      const scope =
        backupScopeMode === "cluster"
          ? { mode: "cluster" as const }
          : { mode: "multiple" as const, namespaces: selectedNamespaces };

      if (scope.mode === "multiple" && scope.namespaces.length === 0) {
        throw new Error("Select at least one namespace for backup.");
      }

      const nextSummary = await createBackupNow(clusterId, { scope });
      const safeCluster = sanitizePathPart(clusterId) || "cluster";
      const safeBackup = sanitizePathPart(nextSummary.backupName ?? `backup-${Date.now()}`);
      const folder = `rozoom/backup/${safeCluster}`;
      const filename = `${folder}/${safeBackup}.json`;
      const payload = {
        clusterId,
        exportedAt: new Date().toISOString(),
        summary: nextSummary,
      };

      await mkdir(folder, { baseDir: BaseDirectory.Download, recursive: true });
      await writeTextFile(filename, JSON.stringify(payload, null, 2), {
        baseDir: BaseDirectory.Download,
      });

      const storageLocation = nextSummary.storage ?? "default";
      actionMessage =
        `Velero backup created. Metadata snapshot saved to ~/Downloads/${filename}. ` +
        `Backup data is stored in Velero BackupStorageLocation "${storageLocation}" ` +
        `(object storage backend such as S3/Blob/GCS configured in your cluster).`;
    } catch (error) {
      actionError = error instanceof Error ? error.message : "Backup creation failed";
    } finally {
      creating = false;
    }
  }

  async function saveBackupPolicy() {
    if (policySaving) return;
    policySaving = true;
    policyError = null;
    policyMessage = null;
    try {
      const nextMaxAgeHours = normalizePositiveInt(policyMaxAgeHours, config.maxAgeHours);
      const nextRetentionDays = normalizePositiveInt(policyRetentionDays, config.retentionDays);
      const nextCacheTtlMinutes = normalizePositiveInt(
        policyCacheTtlMinutes,
        Math.max(1, Math.round(config.cacheTtlMs / 60000)),
      );

      backupPolicyConfig.update((prev) => ({
        ...prev,
        maxAgeHours: nextMaxAgeHours,
        retentionDays: nextRetentionDays,
        cacheTtlMs: nextCacheTtlMinutes * 60 * 1000,
        autoCreateEnabled: policyAutoCreateEnabled,
      }));

      if (!offline && clusterId) {
        await runBackupAudit(clusterId, { force: true, source: "manual" });
      }
      policyMessage = "Backup policy updated.";
    } catch (error) {
      policyError = error instanceof Error ? error.message : "Failed to update backup policy";
    } finally {
      policySaving = false;
    }
  }

  async function restoreNamespace() {
    if (restoring) return;
    if (!restoreBackupName) {
      actionError = "Select backup for restore.";
      return;
    }
    if (!restoreSourceNamespace) {
      actionError = "Select source namespace.";
      return;
    }
    if (!restoreTargetNamespace.trim()) {
      actionError = "Target namespace is required.";
      return;
    }
    const overwriting = availableNamespaces.includes(restoreTargetNamespace.trim());
    const confirmed = await confirmAction(
      `Restore namespace "${restoreSourceNamespace}" from backup "${restoreBackupName}"\n` +
        `into "${restoreTargetNamespace}"?\n\n` +
        (overwriting
          ? `"${restoreTargetNamespace}" already exists in this cluster. Velero will merge / overwrite ` +
            `existing resources there. Running workloads may restart.`
          : `"${restoreTargetNamespace}" will be created if it does not exist.`) +
        "\n\nThis cannot be undone from here (you would need another backup to revert).",
      "Confirm restore",
    );
    if (!confirmed) return;

    restoring = true;
    actionError = null;
    actionMessage = null;
    try {
      await restoreNamespaceFromBackup(clusterId, {
        backupName: restoreBackupName,
        sourceNamespace: restoreSourceNamespace,
        targetNamespace: restoreTargetNamespace,
      });
      actionMessage = `Restore created from backup "${restoreBackupName}" (${restoreSourceNamespace} -> ${restoreTargetNamespace}).`;
      restorePreview = null;
    } catch (error) {
      actionError = error instanceof Error ? error.message : "Namespace restore failed";
    } finally {
      restoring = false;
    }
  }

  async function previewRestore() {
    if (!restoreBackupName) {
      actionError = "Select a backup first.";
      return;
    }
    restorePreview = {
      backupName: restoreBackupName,
      sourceNs: restoreSourceNamespace,
      targetNs: restoreTargetNamespace,
      describe: "",
      loading: true,
      error: null,
    };
    const veleroNs = veleroRelease?.namespace ?? (veleroNamespaceDraft.trim() || "velero");
    const result = await execCliForCluster(
      "kubectl",
      ["get", "backup", restoreBackupName, "-n", veleroNs, "-o", "yaml", "--request-timeout=10s"],
      clusterId,
    );
    if (result.code !== 0) {
      restorePreview = {
        ...restorePreview,
        loading: false,
        error: result.stderr.trim() || `kubectl exited with code ${result.code}`,
      };
      return;
    }
    restorePreview = {
      ...restorePreview,
      loading: false,
      describe: result.stdout.trim() || "(empty backup resource)",
    };
  }

  async function testCredentialsConnection() {
    if (credentialsTesting) return;
    credentialsTesting = true;
    credentialsTestResult = null;
    try {
      const bucketName = bucket.trim();
      if (!bucketName) {
        credentialsTestResult = { ok: false, message: "Enter a bucket name first." };
        return;
      }
      if (provider === "aws" || provider === "do" || provider === "hetzner") {
        const endpoint =
          s3Url.trim() ||
          (provider === "aws" && region.trim() ? `https://s3.${region.trim()}.amazonaws.com` : "");
        if (!endpoint) {
          credentialsTestResult = {
            ok: false,
            message: "Enter S3 endpoint URL or AWS region.",
          };
          return;
        }
        const accessKey = awsAccessKeyId.trim() || doAccessKey.trim();
        const secretKey = awsSecretAccessKey.trim() || doSecretKey.trim();
        if (!accessKey || !secretKey) {
          credentialsTestResult = {
            ok: false,
            message: "Enter an access key and secret key before testing.",
          };
          return;
        }
        const probeUrl = `${endpoint.replace(/\/$/, "")}/${encodeURIComponent(bucketName)}/?list-type=2&max-keys=1`;
        const result = await execCliForCluster(
          "curl",
          ["-sI", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "8", probeUrl],
          clusterId,
        );
        const code = result.stdout.trim();
        if (code === "200" || code === "403") {
          credentialsTestResult = {
            ok: true,
            message:
              code === "200"
                ? `Bucket reachable (HTTP 200). Credentials will be validated by Velero on install.`
                : `Endpoint reachable (HTTP 403). Anonymous probe rejected; Velero will still attempt signed requests.`,
          };
        } else if (code === "404") {
          credentialsTestResult = {
            ok: false,
            message: "Bucket not found (HTTP 404). Check name, region, and endpoint.",
          };
        } else if (!code) {
          credentialsTestResult = {
            ok: false,
            message: `Endpoint unreachable: ${result.stderr.trim().slice(0, 160)}`,
          };
        } else {
          credentialsTestResult = { ok: false, message: `Unexpected HTTP ${code}.` };
        }
      } else {
        credentialsTestResult = {
          ok: true,
          message:
            "Pre-install connectivity test is only available for S3-compatible providers (AWS, DO, Hetzner). For Azure/GCP the credentials will be validated by Velero on install.",
        };
      }
    } finally {
      credentialsTesting = false;
    }
  }

  async function scanBackupsForRestore() {
    if (!clusterId || restoreScanLoading || !hasVeleroInstalled) return;
    restoreScanLoading = true;
    restoreScanError = null;
    try {
      const backups = await scanRestoreBackups(clusterId);
      restoreBackups = backups;
      if (backups.length > 0) {
        if (!backups.some((item) => item.name === restoreBackupName)) {
          restoreBackupName = backups[0].name;
        }
        syncRestoreSourceFromSelection();
      } else {
        restoreBackupName = "";
        restoreSourceNamespace = "";
      }
    } catch (error) {
      restoreBackups = [];
      restoreBackupName = "";
      restoreSourceNamespace = "";
      restoreScanError = error instanceof Error ? error.message : "Failed to scan backups";
    } finally {
      restoreScanLoading = false;
    }
  }

  function syncPageVisibility() {
    if (typeof document === "undefined") {
      pageVisible = true;
      return;
    }
    pageVisible = document.visibilityState !== "hidden";
  }

  onMount(() => {
    syncPageVisibility();
    const handleVisibility = () => {
      syncPageVisibility();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  });

  $effect(() => {
    policyMaxAgeHours = config.maxAgeHours;
    policyRetentionDays = config.retentionDays;
    policyCacheTtlMinutes = Math.max(1, Math.round(config.cacheTtlMs / 60000));
    policyAutoCreateEnabled = config.autoCreateEnabled;
  });

  $effect(() => {
    if (!clusterId) return;

    if (offline) {
      stopBackupAuditPolling(clusterId);
      markBackupAuditUnavailable(clusterId, "Backup status unavailable: cluster is offline");
      availableNamespaces = [];
      selectedNamespace = "";
      selectedNamespaces = [];
      restoreBackups = [];
      restoreBackupName = "";
      restoreSourceNamespace = "";
      return;
    }

    if (!autoDiagnosticsEnabled) {
      stopBackupAuditPolling(clusterId);
      return;
    }

    if (!pageVisible) {
      stopBackupAuditPolling(clusterId);
      return;
    }

    startBackupAuditPolling(clusterId);
    void loadVeleroProfile();
    void refreshVeleroStatus();

    return () => {
      stopBackupAuditPolling(clusterId);
    };
  });
</script>

<Card.Root class="bg-card text-card-foreground">
  <Card.Header class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <h2
          class="text-lg font-semibold"
          title="Backup freshness and metadata for cluster configuration."
        >
          Cluster Backup Status
        </h2>
        {#if summary}
          <Badge class="text-white {statusStyles[summary.status]}">
            {summary.status}
          </Badge>
        {/if}
        <Popover.Root>
          <Popover.Trigger>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 text-muted-foreground hover:text-foreground"
              aria-label="Backup status info"
              title="About backup tools"
            >
              <Info class="h-4 w-4" />
            </Button>
          </Popover.Trigger>
          <Popover.Content class="w-[420px] space-y-3" sideOffset={8}>
            <p class="text-sm font-semibold text-foreground">Backup status sources</p>
            <div class="space-y-2 text-xs text-muted-foreground">
              <p>
                <span class="font-medium text-foreground">Velero:</span>
                Kubernetes-native backup/restore for cluster resources and persistent volumes.
              </p>
              <p>
                <span class="font-medium text-foreground">Helm release check:</span>
                validates whether Velero is installed and where backup jobs run.
              </p>
            </div>
            <div class="space-y-1 text-xs">
              <a
                class="text-primary underline-offset-4 hover:underline"
                href="https://github.com/vmware-tanzu/velero"
                target="_blank"
                rel="noreferrer noopener"
              >
                Velero GitHub
              </a>
              <a
                class="block text-primary underline-offset-4 hover:underline"
                href="https://github.com/helm/helm"
                target="_blank"
                rel="noreferrer noopener"
              >
                Helm GitHub
              </a>
            </div>
          </Popover.Content>
        </Popover.Root>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onclick={runNow}
          loading={checking}
          loadingLabel="Refreshing"
          disabled={creating}
        >
          <Refresh class="mr-2 h-4 w-4" />
          <span>Refresh status</span>
        </Button>
        <Button
          onclick={createBackup}
          loading={creating}
          loadingLabel="Starting backup"
          disabled={checking || !hasVeleroInstalled}
        >
          <span>Create backup now</span>
        </Button>
      </div>
    </div>
    <p class="text-sm text-muted-foreground">
      Ensure critical cluster configuration is backed up within the last
      {formatDuration(config.maxAgeHours)}.
    </p>
  </Card.Header>
  <Card.Content class="space-y-6">
    <div class="rounded-lg border border-border p-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-xs text-muted-foreground">Velero via Helm (cross-namespace check)</p>
          {#if veleroLoading}
            <p class="text-sm text-muted-foreground inline-flex items-center gap-1">
              <span>Checking</span><LoadingDots />
            </p>
          {:else if veleroRelease}
            <p class="text-sm text-foreground">
              Installed: <span class="font-semibold">{veleroRelease.name}</span>
              <span class="text-xs text-muted-foreground">
                v{veleroChartVersion(veleroRelease.chart)}</span
              >
              in
              <span class="font-semibold">{veleroRelease.namespace}</span> namespace
            </p>
          {:else}
            <p class="text-sm text-amber-600">Not installed</p>
          {/if}
        </div>
        <div class="flex flex-wrap items-center gap-2">
          {#if !veleroRelease}
            <input
              class="h-9 min-w-[160px] rounded-md border border-input bg-background px-3 text-sm"
              bind:value={veleroNamespaceDraft}
              placeholder="velero"
              disabled={veleroInstalling}
            />
          {/if}
          <Button
            variant="outline"
            onclick={refreshVeleroStatus}
            loading={veleroLoading}
            loadingLabel="Refreshing"
            disabled={veleroInstalling}
          >
            Refresh status
          </Button>
          {#if !veleroRelease}
            <Button
              variant="outline"
              onclick={() => void testCredentialsConnection()}
              disabled={credentialsTesting || veleroInstalling}
              title="Probe the configured bucket endpoint for reachability before running helm install"
            >
              {#if credentialsTesting}
                <span>Testing</span><LoadingDots />
              {:else}
                <span>Test connection</span>
              {/if}
            </Button>
            <Button
              onclick={installVeleroWithHelm}
              loading={veleroInstalling}
              loadingLabel="Installing"
              disabled={veleroLoading}
            >
              <span>Install Velero (Helm)</span>
            </Button>
          {/if}
        </div>
      </div>
      {#if credentialsTestResult}
        <div
          class={`mt-2 rounded border px-2 py-1.5 text-[11px] ${
            credentialsTestResult.ok
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-rose-500/40 bg-rose-500/10 text-rose-300"
          }`}
        >
          <span class="font-semibold">{credentialsTestResult.ok ? "✓" : "✗"}</span>
          {credentialsTestResult.message}
        </div>
      {/if}
      {#if !veleroRelease}
        <p class="mt-2 text-xs text-muted-foreground">
          Namespace and non-secret fields are saved locally. Secrets/keys are used only during
          install and are not persisted.
        </p>
        <div class="mt-3">
          <p class="mb-1 block text-xs text-muted-foreground">Cloud provider</p>
          <Select.Root type="single" bind:value={provider}>
            <Select.Trigger class="h-9 w-full max-w-[320px]"
              >{providerOptions.find((item) => item.value === provider)?.label ??
                "AWS"}</Select.Trigger
            >
            <Select.Content>
              <Select.Group>
                {#each providerOptions as option}
                  <Select.Item value={option.value}>{option.label}</Select.Item>
                {/each}
              </Select.Group>
            </Select.Content>
          </Select.Root>
          <p class="mt-1 text-xs text-muted-foreground">{providerHints[provider]}</p>
        </div>
        <div class="mt-3 grid gap-2 md:grid-cols-2">
          {#if showS3Inputs}
            <input
              class="h-9 rounded-md border border-input bg-background px-3 text-sm"
              bind:value={bucket}
              placeholder={provider === "do"
                ? "Space name, e.g. cluster-backups"
                : provider === "hetzner"
                  ? "Bucket name, e.g. velero-backups"
                  : "S3 bucket, e.g. velero-prod-backups"}
            />
            <input
              class="h-9 rounded-md border border-input bg-background px-3 text-sm"
              bind:value={region}
              placeholder={provider === "do"
                ? "Region, e.g. nyc3"
                : provider === "hetzner"
                  ? "Region (datacenter), e.g. fsn1, nbg1, hel1"
                  : "Region, e.g. us-east-2"}
            />
            <input
              class="h-9 rounded-md border border-input bg-background px-3 text-sm md:col-span-2"
              bind:value={s3Url}
              placeholder={provider === "do"
                ? "Endpoint (required), e.g. https://nyc3.digitaloceanspaces.com"
                : provider === "hetzner"
                  ? "Endpoint (required), e.g. https://fsn1.your-objectstorage.com"
                  : "S3 URL (optional), e.g. https://s3.us-east-2.amazonaws.com"}
            />
            <label
              class="inline-flex items-center gap-2 text-xs text-muted-foreground md:col-span-2"
            >
              <input type="checkbox" bind:checked={forcePathStyle} />
              Force path-style S3 (for MinIO/compat endpoints)
            </label>
          {/if}

          {#if showAwsAuth}
            <input
              class="h-9 rounded-md border border-input bg-background px-3 text-sm md:col-span-2"
              bind:value={awsIamRoleArn}
              placeholder="IRSA role ARN, e.g. arn:aws:iam::123456789012:role/velero-irsa"
            />
            <input
              class="h-9 rounded-md border border-input bg-background px-3 text-sm"
              bind:value={awsAccessKeyId}
              placeholder="Access key id, e.g. AKIA..."
            />
            <input
              class="h-9 rounded-md border border-input bg-background px-3 text-sm"
              bind:value={awsSecretAccessKey}
              placeholder="Secret key (not saved)"
              type="password"
            />
          {/if}

          {#if showDoAuth}
            <input
              class="h-9 rounded-md border border-input bg-background px-3 text-sm"
              bind:value={doAccessKey}
              placeholder={provider === "hetzner"
                ? "S3 access key (not saved)"
                : "DO Spaces access key (not saved)"}
            />
            <input
              class="h-9 rounded-md border border-input bg-background px-3 text-sm"
              bind:value={doSecretKey}
              placeholder={provider === "hetzner"
                ? "S3 secret key (not saved)"
                : "DO Spaces secret key (not saved)"}
              type="password"
            />
          {/if}

          {#if showAzureInputs}
            <input
              class="h-9 rounded-md border border-input bg-background px-3 text-sm"
              bind:value={bucket}
              placeholder="Blob container, e.g. velero"
            />
            <input
              class="h-9 rounded-md border border-input bg-background px-3 text-sm"
              bind:value={azureResourceGroup}
              placeholder="Resource group, e.g. rg-backup-prod"
            />
            <input
              class="h-9 rounded-md border border-input bg-background px-3 text-sm"
              bind:value={azureStorageAccount}
              placeholder="Storage account, e.g. velerostore01"
            />
            <input
              class="h-9 rounded-md border border-input bg-background px-3 text-sm"
              bind:value={azureSubscriptionId}
              placeholder="Subscription ID, e.g. 11111111-2222-3333-4444-555555555555"
            />
            <input
              class="h-9 rounded-md border border-input bg-background px-3 text-sm md:col-span-2"
              bind:value={azureStorageAccountUri}
              placeholder="Storage account URI (optional), e.g. https://velerostore01.blob.core.windows.net"
            />
            <input
              class="h-9 rounded-md border border-input bg-background px-3 text-sm md:col-span-2"
              bind:value={azureCloudName}
              placeholder="Cloud name, e.g. AzurePublicCloud"
            />
            <input
              class="h-9 rounded-md border border-input bg-background px-3 text-sm"
              bind:value={azureClientId}
              placeholder="Client ID (optional, not saved)"
            />
            <input
              class="h-9 rounded-md border border-input bg-background px-3 text-sm"
              bind:value={azureTenantId}
              placeholder="Tenant ID (optional, not saved)"
            />
            <input
              class="h-9 rounded-md border border-input bg-background px-3 text-sm md:col-span-2"
              bind:value={azureClientSecret}
              placeholder="Client secret (optional, not saved)"
              type="password"
            />
          {/if}

          {#if showGcpInputs}
            <input
              class="h-9 rounded-md border border-input bg-background px-3 text-sm"
              bind:value={bucket}
              placeholder="GCS bucket, e.g. velero-cluster-backups"
            />
            <input
              class="h-9 rounded-md border border-input bg-background px-3 text-sm"
              bind:value={gcpProject}
              placeholder="Project ID (optional), e.g. my-prod-project"
            />
            <input
              class="h-9 rounded-md border border-input bg-background px-3 text-sm md:col-span-2"
              bind:value={gcpServiceAccount}
              placeholder="Workload identity service account (optional), e.g. velero@my-prod-project.iam.gserviceaccount.com"
            />
            <textarea
              class="min-h-[96px] rounded-md border border-input bg-background px-3 py-2 text-sm md:col-span-2"
              bind:value={gcpCredentialsJson}
              placeholder="Service account JSON (optional, not saved), e.g. type=service_account, project_id=my-prod-project"
            ></textarea>
          {/if}
        </div>
      {/if}
      {#if veleroError}
        <p class="mt-2 text-xs text-rose-600">{veleroError}</p>
      {/if}
      {#if helmActionMessage}
        <p class="mt-2 text-xs text-emerald-600">{helmActionMessage}</p>
      {/if}
      {#if helmActionError}
        <p class="mt-2 text-xs text-rose-600">{helmActionError}</p>
      {/if}
      <div class="mt-2">
        <CommandConsole session={veleroInstallSession} label="Velero" />
      </div>
    </div>

    {#if hasVeleroInstalled}
      <div class="rounded-lg border border-border p-4 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-semibold text-foreground">Backup scope</h3>
          <Button
            variant="outline"
            onclick={loadNamespaces}
            loading={namespaceLoading}
            disabled={creating}
          >
            {#if namespaceLoading}
              <span>Loading namespaces</span><LoadingDots />
            {:else}
              <span>Refresh namespaces</span>
            {/if}
          </Button>
        </div>
        <p class="text-xs text-muted-foreground">
          Choose backup scope: full cluster or selected namespaces.
        </p>
        <div class="grid gap-2 md:grid-cols-2">
          <label class="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
            <input type="radio" name="backup-scope" value="cluster" bind:group={backupScopeMode} />
            <span>Full Cluster</span>
          </label>
          <label class="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
            <input type="radio" name="backup-scope" value="multiple" bind:group={backupScopeMode} />
            <span>Namespaces</span>
          </label>
        </div>

        {#if backupScopeMode === "multiple"}
          <div class="max-h-56 overflow-auto rounded-md border border-border p-2">
            {#if availableNamespaces.length === 0}
              <p class="text-xs text-muted-foreground">No namespaces loaded.</p>
            {:else}
              <div class="mb-2 flex items-center justify-between border-b border-border/60 pb-2">
                <span class="text-[11px] text-muted-foreground">
                  {selectedNamespaces.length}/{availableNamespaces.length} selected
                </span>
                <div class="flex gap-2">
                  <button
                    type="button"
                    class="text-[11px] text-sky-400 hover:underline"
                    onclick={() => {
                      selectedNamespaces = [...availableNamespaces];
                    }}
                    disabled={selectedNamespaces.length === availableNamespaces.length}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    class="text-[11px] text-muted-foreground hover:text-foreground"
                    onclick={() => {
                      selectedNamespaces = [];
                    }}
                    disabled={selectedNamespaces.length === 0}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div class="grid gap-1 md:grid-cols-2">
                {#each availableNamespaces as ns}
                  <label class="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedNamespaces.includes(ns)}
                      onchange={(event) => {
                        const checked = (event.currentTarget as HTMLInputElement).checked;
                        if (checked) {
                          selectedNamespaces = [...selectedNamespaces, ns];
                        } else {
                          selectedNamespaces = selectedNamespaces.filter((item) => item !== ns);
                        }
                      }}
                    />
                    <span>{ns}</span>
                  </label>
                {/each}
              </div>
            {/if}
          </div>
        {/if}

        {#if namespaceError}
          <p class="text-xs text-rose-600">{namespaceError}</p>
        {/if}
      </div>
    {/if}

    {#if summary?.status === "failed"}
      <Alert.Root variant="destructive">
        <Alert.Title>Backup failed</Alert.Title>
        <Alert.Description>
          {summary?.message ?? "Backup job failed."}
          {#if latestRun?.metadata?.validationErrors?.length}
            <div class="mt-2 text-xs">
              {latestRun.metadata.validationErrors[0]}
            </div>
          {/if}
        </Alert.Description>
      </Alert.Root>
    {:else if summary?.status === "unverifiable"}
      <Alert.Root variant="default">
        <Alert.Title>Unable to verify backup</Alert.Title>
        <Alert.Description>Check cluster connectivity or backup storage.</Alert.Description>
      </Alert.Root>
    {/if}
    {#if actionMessage}
      <Alert.Root variant="default">
        <Alert.Title>Status</Alert.Title>
        <Alert.Description>{actionMessage}</Alert.Description>
      </Alert.Root>
    {/if}
    {#if actionError}
      {@const humanized = humanizeVeleroError(actionError)}
      <Alert.Root variant="destructive">
        <Alert.Title>{humanized.title}</Alert.Title>
        <Alert.Description>
          {#if humanized.hint}
            <p class="mb-1">{humanized.hint}</p>
          {/if}
          <pre class="whitespace-pre-wrap text-[11px] opacity-80">{actionError}</pre>
        </Alert.Description>
      </Alert.Root>
    {/if}
    {#if summary?.warnings?.length}
      <Alert.Root>
        <Alert.Title>Warnings</Alert.Title>
        <Alert.Description>
          <ul class="list-disc pl-4 text-xs">
            {#each summary.warnings as warning}
              <li>{warning}</li>
            {/each}
          </ul>
        </Alert.Description>
      </Alert.Root>
    {/if}
    {#if summary?.errors?.length}
      <Alert.Root variant="destructive">
        <Alert.Title>Source errors</Alert.Title>
        <Alert.Description>
          <ul class="list-disc pl-4 text-xs">
            {#each summary.errors as err}
              <li>{err}</li>
            {/each}
          </ul>
        </Alert.Description>
      </Alert.Root>
    {/if}

    {#if backupFreshness.ageHours !== null && backupFreshness.severity !== "ok"}
      <div
        class={`rounded-md border px-3 py-2 text-xs ${
          backupFreshness.severity === "critical"
            ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
            : "border-amber-500/40 bg-amber-500/10 text-amber-300"
        }`}
      >
        <div class="flex items-center justify-between gap-2">
          <div>
            <span class="font-semibold">
              {backupFreshness.severity === "critical"
                ? "Backup is past its max-age policy"
                : "Backup is approaching max-age"}:
            </span>
            {Math.round(backupFreshness.ageHours)}h old of {policyMaxAgeHours}h limit ({Math.round(
              backupFreshness.percent * 100,
            )}%).
          </div>
          <Button
            variant="outline"
            size="sm"
            class="h-6 text-[11px]"
            onclick={createBackup}
            disabled={creating || !hasVeleroInstalled}
          >
            {creating ? "Creating…" : "Create backup now"}
          </Button>
        </div>
      </div>
    {/if}

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <DiagnosticSummaryCard title="Last backup">
        <p class="text-sm font-semibold text-foreground">
          {formatDate(summary?.lastBackupAt ?? null)}
        </p>
        {#if backupFreshness.ageHours !== null}
          <p
            class={`text-xs ${
              backupFreshness.severity === "critical"
                ? "text-rose-400"
                : backupFreshness.severity === "warning"
                  ? "text-amber-400"
                  : "text-muted-foreground"
            }`}
          >
            {Math.round(backupFreshness.ageHours)}h ago / policy {policyMaxAgeHours}h
          </p>
        {/if}
      </DiagnosticSummaryCard>
      <DiagnosticSummaryCard title="Next due">
        <p class="text-sm font-semibold text-foreground">
          {formatDate(summary?.nextDueAt ?? null)}
        </p>
      </DiagnosticSummaryCard>
      <DiagnosticSummaryCard title="Storage location">
        <p class="text-sm font-semibold text-foreground">{summary?.storage ?? "-"}</p>
        <p class="text-xs text-muted-foreground">Velero BSL name (backend: S3/Blob/GCS)</p>
      </DiagnosticSummaryCard>
      <DiagnosticSummaryCard title="Latest backup name">
        <p class="text-sm font-semibold text-foreground break-all">{summary?.backupName ?? "-"}</p>
      </DiagnosticSummaryCard>
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <DiagnosticSummaryCard title="Backup policy">
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock4 class="h-4 w-4" />
        </div>
        <div class="mt-2 grid gap-2">
          <div class="grid grid-cols-3 gap-2">
            <div class="space-y-1">
              <label for="policy-max-age" class="block text-[11px] text-muted-foreground">
                Max age (hours)
              </label>
              <input
                id="policy-max-age"
                class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                type="number"
                min="1"
                bind:value={policyMaxAgeHours}
                title="Warn / auto-create a new backup when the latest one is older than this. Example: 24 = tolerate up to 1-day RPO."
              />
            </div>
            <div class="space-y-1">
              <label for="policy-retention" class="block text-[11px] text-muted-foreground">
                Retention (days)
              </label>
              <input
                id="policy-retention"
                class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                type="number"
                min="1"
                bind:value={policyRetentionDays}
                title="Velero TTL: backups older than this are deleted by the Velero GC controller. Backup objects remain in the cluster until the TTL elapses."
              />
            </div>
            <div class="space-y-1">
              <label for="policy-cache-ttl" class="block text-[11px] text-muted-foreground">
                Audit cache (min)
              </label>
              <input
                id="policy-cache-ttl"
                class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                type="number"
                min="1"
                bind:value={policyCacheTtlMinutes}
                title="How often ROZOOM re-reads Velero state. Larger value = less API pressure; smaller value = fresher status on this page."
              />
            </div>
          </div>
          <label class="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              bind:checked={policyAutoCreateEnabled}
              disabled={!hasVeleroInstalled}
            />
            Auto-create backup when current status is not OK (while app is running)
          </label>
          {#if !hasVeleroInstalled}
            <p class="text-xs text-muted-foreground">
              Auto-create stays inactive until a Velero Helm release is installed.
            </p>
          {/if}
          <div class="flex items-center gap-2">
            <Button variant="outline" onclick={saveBackupPolicy} disabled={policySaving}>
              {#if policySaving}
                <span>Saving policy</span><LoadingDots />
              {:else}
                <span>Save policy</span>
              {/if}
            </Button>
            <p class="text-xs text-muted-foreground">Source: {summary?.source ?? "none"}</p>
          </div>
          {#if policyMessage}
            <p class="text-xs text-emerald-600">{policyMessage}</p>
          {/if}
          {#if policyError}
            <p class="text-xs text-rose-600">{policyError}</p>
          {/if}
        </div>
      </DiagnosticSummaryCard>
      <DiagnosticSummaryCard title="Status">
        <p class="text-sm font-semibold text-foreground">{summary?.message ?? "Backup unknown"}</p>
        <p class="text-xs text-muted-foreground">
          Last backup timestamp: {formatDate(summary?.lastBackupAt ?? null)}
        </p>
      </DiagnosticSummaryCard>
    </div>

    <div class="space-y-3">
      <h3 class="text-sm font-semibold text-foreground">Recent backups</h3>
      <TableSurface maxHeightClass="max-h-[520px]">
        <Table.Table>
          <Table.TableHeader>
            <Table.TableRow>
              <Table.TableHead>Run time</Table.TableHead>
              <Table.TableHead>Age</Table.TableHead>
              <Table.TableHead>Duration</Table.TableHead>
              <Table.TableHead>Status</Table.TableHead>
              <Table.TableHead>Name</Table.TableHead>
              <Table.TableHead>Scope</Table.TableHead>
              <Table.TableHead>Storage</Table.TableHead>
              <Table.TableHead>Phase</Table.TableHead>
              <Table.TableHead>Details</Table.TableHead>
              <Table.TableHead>Source</Table.TableHead>
            </Table.TableRow>
          </Table.TableHeader>
          <Table.TableBody>
            {#if history.length === 0}
              <Table.TableRow>
                <Table.TableCell colspan={10} class="text-center">
                  <TableEmptyState
                    message={hasVeleroInstalled
                      ? "No backups recorded yet. Click Create backup now to run the first one."
                      : "Install Velero above to enable automated cluster backups."}
                  />
                </Table.TableCell>
              </Table.TableRow>
            {:else}
              {#each history as run}
                {@const details =
                  run.metadata?.failureReason ||
                  run.metadata?.validationErrors?.[0] ||
                  run.reason ||
                  ""}
                {@const humanized = details ? humanizeVeleroError(details) : null}
                {@const ageHours =
                  run.runAt && !Number.isNaN(Date.parse(run.runAt))
                    ? (Date.now() - Date.parse(run.runAt)) / 3_600_000
                    : null}
                {@const ageOverRetention = ageHours !== null && ageHours > policyRetentionDays * 24}
                <Table.TableRow>
                  <Table.TableCell>{formatDate(run.runAt)}</Table.TableCell>
                  <Table.TableCell
                    class={ageOverRetention ? "text-rose-400" : ""}
                    title={ageOverRetention
                      ? `Older than retention (${policyRetentionDays}d). Velero may have already GC'd this object.`
                      : ""}
                  >
                    {formatRelativeAge(run.runAt)}
                  </Table.TableCell>
                  <Table.TableCell class="font-mono text-xs"
                    >{formatRunDuration(run)}</Table.TableCell
                  >
                  <Table.TableCell>
                    <Badge class="text-white {statusStyles[run.status]}">
                      {run.status}
                    </Badge>
                  </Table.TableCell>
                  <Table.TableCell class="max-w-[180px] truncate" title={run.metadata?.name ?? ""}>
                    {run.metadata?.name ?? "-"}
                  </Table.TableCell>
                  <Table.TableCell>{run.metadata ? formatRunScope(run) : "-"}</Table.TableCell>
                  <Table.TableCell>{run.metadata?.storage ?? "-"}</Table.TableCell>
                  <Table.TableCell>{run.metadata?.phase ?? "-"}</Table.TableCell>
                  <Table.TableCell class="max-w-[360px]" title={details || "-"}>
                    {#if humanized && humanized.title !== "Backup action failed"}
                      <div class="text-xs font-medium text-rose-300">{humanized.title}</div>
                      {#if humanized.hint}
                        <div class="truncate text-[11px] text-muted-foreground">
                          {humanized.hint}
                        </div>
                      {/if}
                    {:else}
                      <span class="block truncate text-xs">{details || "-"}</span>
                    {/if}
                  </Table.TableCell>
                  <Table.TableCell>{run.source}</Table.TableCell>
                </Table.TableRow>
              {/each}
            {/if}
          </Table.TableBody>
        </Table.Table>
      </TableSurface>
    </div>

    <div class="rounded-lg border border-border p-4 space-y-3">
      <h3 class="text-sm font-semibold text-foreground">Restore Namespace From Backup</h3>
      <div class="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          onclick={scanBackupsForRestore}
          loading={restoreScanLoading}
          disabled={!hasVeleroInstalled}
        >
          {#if restoreScanLoading}
            <span>Scanning backups</span><LoadingDots />
          {:else}
            <span>Scan backups</span>
          {/if}
        </Button>
      </div>

      <div class="grid gap-2 md:grid-cols-3">
        <div class="space-y-1">
          <label for="restore-backup-select" class="text-xs text-muted-foreground">Backup</label>
          <select
            id="restore-backup-select"
            class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            bind:value={restoreBackupName}
            onchange={() => syncRestoreSourceFromSelection()}
          >
            <option value="" disabled>Select backup</option>
            {#each restoreBackups as backup}
              <option value={backup.name}>
                {backup.name} ({backup.phase}, {formatDate(backup.createdAt)})
              </option>
            {/each}
          </select>
        </div>

        <div class="space-y-1">
          <label for="restore-source-namespace" class="text-xs text-muted-foreground"
            >Source namespace</label
          >
          <select
            id="restore-source-namespace"
            class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            bind:value={restoreSourceNamespace}
          >
            <option value="" disabled>Select source namespace</option>
            {#each getRestoreSourceOptions(restoreBackupName) as ns}
              <option value={ns}>{ns}</option>
            {/each}
          </select>
        </div>

        <div class="space-y-1">
          <label for="restore-target-namespace" class="text-xs text-muted-foreground">
            Target namespace
          </label>
          <input
            id="restore-target-namespace"
            class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            bind:value={restoreTargetNamespace}
            placeholder="Target namespace"
          />
        </div>
      </div>

      {#if restoreScanError}
        <p class="text-xs text-rose-600">{restoreScanError}</p>
      {/if}

      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          onclick={() => void previewRestore()}
          disabled={!restoreBackupName || restoring}
          title="Show the backup manifest that will be used as the source"
        >
          Preview backup
        </Button>
        <Button
          variant="outline"
          onclick={restoreNamespace}
          disabled={restoring || !restoreBackupName}
        >
          {#if restoring}
            <span>Starting restore</span><LoadingDots />
          {:else}
            <span>Apply restore</span>
          {/if}
        </Button>
      </div>
      {#if restorePreview}
        <div class="mt-2 rounded-md border border-border bg-muted/30 p-3">
          <div class="mb-1 flex items-center justify-between gap-2">
            <p class="text-xs font-semibold text-foreground">
              Backup: {restorePreview.backupName} · {restorePreview.sourceNs} →
              {restorePreview.targetNs}
            </p>
            <Button
              variant="ghost"
              size="sm"
              class="h-6 text-[11px]"
              onclick={() => (restorePreview = null)}
            >
              Dismiss
            </Button>
          </div>
          {#if restorePreview.loading}
            <div class="flex items-center gap-2 text-xs text-muted-foreground">
              <LoadingDots /> Loading backup manifest…
            </div>
          {:else if restorePreview.error}
            <div class="text-xs text-rose-400">{restorePreview.error}</div>
          {:else}
            <pre
              class="max-h-60 overflow-auto whitespace-pre-wrap rounded bg-slate-950/70 p-2 text-[11px] font-mono text-slate-300">{restorePreview.describe}</pre>
          {/if}
        </div>
      {/if}
    </div>
  </Card.Content>
</Card.Root>
