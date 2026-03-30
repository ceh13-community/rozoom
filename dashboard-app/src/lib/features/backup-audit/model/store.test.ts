import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { execCli, spawnCli } from "$shared/api/cli";
import { getVeleroRelease } from "$shared/api/helm";
import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import {
  resetClusterRuntimeContext,
  setClusterRuntimeBudget,
  setClusterRuntimeContext,
} from "$shared/lib/cluster-runtime-manager";
import { resetFeatureCapabilityCache } from "$features/check-health/model/feature-capability-cache";
import {
  backupAuditState,
  backupPolicyConfig,
  createBackupNow,
  listClusterNamespaces,
  runBackupAudit,
  scanRestoreBackups,
  startBackupAuditPolling,
  stopBackupAuditPolling,
} from "./store";

vi.mock("$shared/api/cli", () => ({
  execCli: vi.fn(),
  spawnCli: vi.fn(),
}));

vi.mock("$shared/api/helm", () => ({
  getVeleroRelease: vi.fn(),
}));

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawArgsFront: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn().mockResolvedValue("/tmp/app"),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: "appData" },
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
}));

describe("backup audit store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-16T12:00:00Z"));
    vi.clearAllMocks();
    resetClusterRuntimeContext();
    resetFeatureCapabilityCache();
    backupPolicyConfig.set({
      maxAgeHours: 24,
      retentionDays: 30,
      cacheTtlMs: 10 * 60 * 1000,
      scheduleMs: 15 * 60 * 1000,
      autoCreateEnabled: false,
    });
    backupAuditState.set({});
    vi.mocked(getVeleroRelease).mockResolvedValue({
      installed: true,
      release: { name: "velero", namespace: "velero", chart: "vmware-tanzu/velero" },
    });
    vi.mocked(spawnCli).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetClusterRuntimeContext();
  });

  it("uses velero cli output as primary source", async () => {
    vi.mocked(execCli).mockResolvedValueOnce({
      code: 0,
      stdout: JSON.stringify({
        items: [
          {
            metadata: {
              uid: "1",
              name: "daily-1",
              creationTimestamp: "2026-02-16T10:00:00Z",
            },
            spec: { storageLocation: "default" },
            status: { phase: "Completed", completionTimestamp: "2026-02-16T10:05:00Z" },
          },
        ],
      }),
      stderr: "",
    });

    const summary = await runBackupAudit("cluster-a", { force: true, source: "manual" });

    expect(summary.source).toBe("velero-cli");
    expect(summary.status).toBe("ok");
    expect(summary.backupName).toBe("daily-1");
  });

  it("captures included namespaces in backup metadata", async () => {
    vi.mocked(execCli).mockResolvedValueOnce({
      code: 0,
      stdout: JSON.stringify({
        items: [
          {
            metadata: {
              uid: "1",
              name: "daily-ns",
              creationTimestamp: "2026-02-16T10:00:00Z",
            },
            spec: { storageLocation: "default", includedNamespaces: ["default", "kube-system"] },
            status: { phase: "Completed", completionTimestamp: "2026-02-16T10:05:00Z" },
          },
        ],
      }),
      stderr: "",
    });

    await runBackupAudit("cluster-a", { force: true, source: "manual" });
    const run = get(backupAuditState)["cluster-a"]?.history[0];

    expect(run?.metadata?.includedNamespaces).toEqual(["default", "kube-system"]);
  });

  it("falls back to velero crd when velero binary is unavailable", async () => {
    vi.mocked(execCli).mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "scoped command velero not found",
    });
    vi.mocked(kubectlRawArgsFront).mockResolvedValueOnce({
      output: JSON.stringify({
        items: [
          {
            metadata: {
              uid: "2",
              name: "daily-crd",
              creationTimestamp: "2026-02-16T10:00:00Z",
            },
            spec: { storageLocation: "default" },
            status: { phase: "Completed", completionTimestamp: "2026-02-16T10:05:00Z" },
          },
        ],
      }),
      errors: "",
      code: 0,
    });

    const summary = await runBackupAudit("cluster-a", { force: true, source: "manual" });

    expect(summary.source).toBe("velero-crd");
    expect(summary.warnings?.join(" ")).toContain("Falling back");
  });

  it("reports unverifiable when both velero cli and crd fallback fail", async () => {
    vi.mocked(execCli).mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "scoped command velero not found",
    });
    vi.mocked(kubectlRawArgsFront).mockResolvedValueOnce({
      output: "",
      errors: "the server could not find the requested resource",
      code: 1,
    });

    const summary = await runBackupAudit("cluster-a", { force: true, source: "manual" });

    expect(summary.status).toBe("unverifiable");
    expect(summary.errors?.join(" ")).toContain("both CLI and backups.velero.io CRD");
  });

  it("surfaces a specific message when the Velero backup CRD is missing", async () => {
    vi.mocked(execCli).mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "scoped command velero not found",
    });
    vi.mocked(kubectlRawArgsFront).mockResolvedValueOnce({
      output: "",
      errors: 'error: the server doesn\'t have a resource type "backups"',
      code: 1,
    });

    const summary = await runBackupAudit("cluster-a", { force: true, source: "manual" });

    expect(summary.status).toBe("unverifiable");
    expect(summary.message).toBe("Velero backup CRD is not installed on this cluster");
  });

  it("includes failure reason details for failed backups from crd fallback", async () => {
    vi.mocked(execCli).mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "scoped command velero not found",
    });
    vi.mocked(kubectlRawArgsFront).mockResolvedValueOnce({
      output: JSON.stringify({
        items: [
          {
            metadata: {
              uid: "failed-1",
              name: "dashboard-manual-failed",
              creationTimestamp: "2026-02-16T22:10:13Z",
            },
            spec: { storageLocation: "default" },
            status: {
              phase: "FailedValidation",
              completionTimestamp: "2026-02-16T22:10:20Z",
              failureReason: "BackupStorageLocation default is unavailable",
              validationErrors: ["BackupStorageLocation default is unavailable"],
            },
          },
        ],
      }),
      errors: "",
      code: 0,
    });

    const summary = await runBackupAudit("cluster-a", { force: true, source: "manual" });
    const run = get(backupAuditState)["cluster-a"]?.history[0];

    expect(summary.status).toBe("failed");
    expect(summary.message).toContain("FailedValidation");
    expect(summary.message).toContain("BackupStorageLocation default is unavailable");
    expect(run?.metadata?.failureReason).toContain("BackupStorageLocation");
    expect(run?.metadata?.validationErrors?.[0]).toContain("BackupStorageLocation");
  });

  it("creates backup with velero cli and refreshes summary", async () => {
    vi.mocked(execCli)
      .mockResolvedValueOnce({ code: 0, stdout: "Backup request submitted", stderr: "" })
      .mockResolvedValueOnce({
        code: 0,
        stdout: JSON.stringify({
          items: [
            {
              metadata: {
                uid: "3",
                name: "dashboard-manual-2026-02-16T10-00-00-000Z",
                creationTimestamp: "2026-02-16T10:00:00Z",
              },
              spec: { storageLocation: "default" },
              status: { phase: "Completed", completionTimestamp: "2026-02-16T10:05:00Z" },
            },
          ],
        }),
        stderr: "",
      });

    const summary = await createBackupNow("cluster-a");
    const current = get(backupAuditState)["cluster-a"]?.summary;

    expect(summary.status).toBe("ok");
    expect(current?.backupName).toContain("dashboard-manual-");
  });

  it("adds actionable copy when velero pod-exec fallback exits with code 127", async () => {
    vi.mocked(execCli).mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "velero create failed",
    });
    vi.mocked(kubectlRawArgsFront)
      .mockResolvedValueOnce({
        output: "",
        errors: "crd create failed",
        code: 1,
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [
            { metadata: { name: "velero-0", namespace: "velero" }, status: { phase: "Running" } },
          ],
        }),
        errors: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        output: "",
        errors:
          'Defaulted container "velero" out of: velero, velero-plugin-for-aws (init)\ncommand terminated with exit code 127',
        code: 127,
      });

    await expect(createBackupNow("cluster-a")).rejects.toThrow(/pod-exec fallback is unavailable/i);
  });

  it("loads namespace list from cluster", async () => {
    vi.mocked(kubectlRawArgsFront).mockResolvedValueOnce({
      output: JSON.stringify({
        items: [{ metadata: { name: "kube-system" } }, { metadata: { name: "default" } }],
      }),
      errors: "",
      code: 0,
    });

    const namespaces = await listClusterNamespaces("cluster-a");

    expect(namespaces).toEqual(["default", "kube-system"]);
  });

  it("passes include-namespaces for scoped backup", async () => {
    vi.mocked(execCli)
      .mockResolvedValueOnce({ code: 0, stdout: "Backup request submitted", stderr: "" })
      .mockResolvedValueOnce({
        code: 0,
        stdout: JSON.stringify({
          items: [
            {
              metadata: {
                uid: "3",
                name: "dashboard-manual-2026-02-16T10-00-00-000Z",
                creationTimestamp: "2026-02-16T10:00:00Z",
              },
              spec: { storageLocation: "default" },
              status: { phase: "Completed", completionTimestamp: "2026-02-16T10:05:00Z" },
            },
          ],
        }),
        stderr: "",
      });

    await createBackupNow("cluster-a", {
      scope: { mode: "multiple", namespaces: ["default", "kube-system"] },
    });

    expect(execCli).toHaveBeenNthCalledWith(
      1,
      "velero",
      expect.arrayContaining(["--include-namespaces", "default,kube-system"]),
    );
  });

  it("scans backups for restore selection", async () => {
    vi.mocked(execCli).mockResolvedValueOnce({
      code: 0,
      stdout: JSON.stringify({
        items: [
          {
            metadata: {
              uid: "restore-1",
              name: "prod-2026-02-16",
              creationTimestamp: "2026-02-16T10:00:00Z",
            },
            spec: { storageLocation: "default", includedNamespaces: ["payments"] },
            status: { phase: "Completed", completionTimestamp: "2026-02-16T10:05:00Z" },
          },
        ],
      }),
      stderr: "",
    });

    const result = await scanRestoreBackups("cluster-a");

    expect(result).toEqual([
      {
        name: "prod-2026-02-16",
        createdAt: "2026-02-16T10:00:00.000Z",
        phase: "Completed",
        storage: "default",
        includedNamespaces: ["payments"],
      },
    ]);
  });

  it("auto-creates backup on polling when enabled and status is missing", async () => {
    backupPolicyConfig.update((prev) => ({
      ...prev,
      autoCreateEnabled: true,
      scheduleMs: 1_000,
    }));

    vi.mocked(execCli)
      // connect run: backup get -> no items => missing
      .mockResolvedValueOnce({
        code: 0,
        stdout: JSON.stringify({ items: [] }),
        stderr: "",
      })
      // auto-create: backup create
      .mockResolvedValueOnce({
        code: 0,
        stdout: "Backup request submitted",
        stderr: "",
      })
      // refresh after create: backup get -> now one item
      .mockResolvedValueOnce({
        code: 0,
        stdout: JSON.stringify({
          items: [
            {
              metadata: {
                uid: "auto-1",
                name: "dashboard-manual-auto",
                creationTimestamp: "2026-02-16T11:00:00Z",
              },
              spec: { storageLocation: "default" },
              status: { phase: "Completed", completionTimestamp: "2026-02-16T11:01:00Z" },
            },
          ],
        }),
        stderr: "",
      });

    startBackupAuditPolling("cluster-a");
    await vi.waitFor(() => {
      expect(execCli).toHaveBeenCalledWith("velero", expect.arrayContaining(["backup", "create"]));
    });
    stopBackupAuditPolling("cluster-a");
    expect(get(backupAuditState)["cluster-a"]?.summary.backupName).toBe("dashboard-manual-auto");
  });

  it("does not auto-create backup on polling when disabled", async () => {
    backupPolicyConfig.update((prev) => ({
      ...prev,
      autoCreateEnabled: false,
      scheduleMs: 1_000,
    }));

    vi.mocked(execCli).mockResolvedValueOnce({
      code: 0,
      stdout: JSON.stringify({ items: [] }),
      stderr: "",
    });

    startBackupAuditPolling("cluster-a");
    await vi.waitFor(() => {
      expect(execCli).toHaveBeenCalledTimes(1);
    });
    stopBackupAuditPolling("cluster-a");

    expect(execCli).not.toHaveBeenCalledWith(
      "velero",
      expect.arrayContaining(["backup", "create"]),
    );
  });

  it("keeps polling suspended when heavy diagnostics budget is zero", async () => {
    backupPolicyConfig.update((prev) => ({
      ...prev,
      scheduleMs: 1_000,
    }));
    vi.mocked(execCli).mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({ items: [] }),
      stderr: "",
    });

    setClusterRuntimeContext({ activeClusterId: "cluster-a", diagnosticsEnabled: true });
    setClusterRuntimeBudget({ maxConcurrentHeavyChecks: 0 });

    startBackupAuditPolling("cluster-a");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(execCli).not.toHaveBeenCalled();

    setClusterRuntimeBudget({ maxConcurrentHeavyChecks: 1 });
    await vi.advanceTimersByTimeAsync(1);
    expect(execCli).toHaveBeenCalledTimes(1);

    stopBackupAuditPolling("cluster-a");
  });

  it("deduplicates concurrent runs for the same cluster", async () => {
    let resolveCli: ((value: { code: number; stdout: string; stderr: string }) => void) | undefined;
    vi.mocked(execCli).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCli = resolve;
        }) as any,
    );

    const first = runBackupAudit("cluster-a", { force: true, source: "auto" });
    const second = runBackupAudit("cluster-a", { force: true, source: "auto" });

    await vi.waitFor(() => {
      expect(execCli).toHaveBeenCalledTimes(1);
    });

    resolveCli?.({
      code: 0,
      stdout: JSON.stringify({
        items: [
          {
            metadata: {
              uid: "1",
              name: "daily-1",
              creationTimestamp: "2026-02-16T10:00:00Z",
            },
            spec: { storageLocation: "default" },
            status: { phase: "Completed", completionTimestamp: "2026-02-16T10:05:00Z" },
          },
        ],
      }),
      stderr: "",
    });

    const [firstSummary, secondSummary] = await Promise.all([first, second]);
    expect(firstSummary).toEqual(secondSummary);
  });
});
