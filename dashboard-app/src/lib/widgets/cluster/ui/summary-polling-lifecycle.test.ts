import { render, waitFor } from "@testing-library/svelte";
import { writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSummaryBootstrapQueue } from "./model/summary-bootstrap-queue";

const page = { url: new URL("http://localhost/dashboard") };
const navigating = { to: null };
const dashboardDataProfile = writable({ allowAutoDiagnostics: true });

const versionAuditState = writable<Record<string, { summary?: unknown }>>({});
const startVersionAuditPolling = vi.fn();
const stopVersionAuditPolling = vi.fn();
const runVersionAudit = vi.fn(() => Promise.resolve());
const markVersionAuditUnavailable = vi.fn();

const backupAuditState = writable<Record<string, { summary?: unknown }>>({});
const startBackupAuditPolling = vi.fn();
const stopBackupAuditPolling = vi.fn();
const runBackupAudit = vi.fn(() => Promise.resolve());
const markBackupAuditUnavailable = vi.fn();

const deprecationScanState = writable<Record<string, { summary?: unknown }>>({});
const startDeprecationScanPolling = vi.fn();
const stopDeprecationScanPolling = vi.fn();
const runDeprecationScan = vi.fn(() => Promise.resolve());
const markScanUnavailable = vi.fn();

vi.mock("$app/state", () => ({
  page,
  navigating,
}));

vi.mock("$shared/lib/runtime-debug", () => ({
  writeRuntimeDebugLog: vi.fn(() => Promise.resolve()),
}));

vi.mock("$shared/lib/dashboard-data-profile.svelte", () => ({
  dashboardDataProfile,
  shouldAutoRunDiagnostics: (profile: { allowAutoDiagnostics?: boolean }) =>
    profile.allowAutoDiagnostics !== false,
}));

vi.mock("$features/version-audit", () => ({
  versionAuditState,
  startVersionAuditPolling,
  stopVersionAuditPolling,
  runVersionAudit,
  markVersionAuditUnavailable,
}));

vi.mock("$features/backup-audit", () => ({
  backupAuditState,
  startBackupAuditPolling,
  stopBackupAuditPolling,
  runBackupAudit,
  markBackupAuditUnavailable,
}));

vi.mock("$features/deprecation-scan", () => ({
  deprecationScanState,
  startDeprecationScanPolling,
  stopDeprecationScanPolling,
  runDeprecationScan,
  markScanUnavailable,
}));

describe("summary polling lifecycle", () => {
  beforeEach(() => {
    resetSummaryBootstrapQueue();
    page.url = new URL("http://localhost/dashboard");
    navigating.to = null;
    dashboardDataProfile.set({ allowAutoDiagnostics: true });
    versionAuditState.set({});
    backupAuditState.set({});
    deprecationScanState.set({});
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps version summary polling active when the summary store updates", async () => {
    const { unmount } = render((await import("./version-audit-summary.svelte")).default, {
      props: { clusterId: "cluster-a" },
    });

    await waitFor(() => {
      expect(startVersionAuditPolling).toHaveBeenCalledTimes(1);
      expect(runVersionAudit).toHaveBeenCalledTimes(1);
    });

    versionAuditState.set({
      "cluster-a": {
        summary: { k8sStatus: "ok", k8sVersion: "v1.32.0" },
      },
    });

    await waitFor(() => {
      expect(startVersionAuditPolling).toHaveBeenCalledTimes(1);
      expect(stopVersionAuditPolling).not.toHaveBeenCalled();
    });

    unmount();

    expect(stopVersionAuditPolling).toHaveBeenCalledTimes(1);
  });

  it("keeps backup summary polling active when the summary store updates", async () => {
    const { unmount } = render((await import("./backup-audit-summary.svelte")).default, {
      props: { clusterId: "cluster-a" },
    });

    await waitFor(() => {
      expect(startBackupAuditPolling).toHaveBeenCalledTimes(1);
      expect(runBackupAudit).toHaveBeenCalledTimes(1);
    });

    backupAuditState.set({
      "cluster-a": {
        summary: { status: "ok", message: "Backups healthy" },
      },
    });

    await waitFor(() => {
      expect(startBackupAuditPolling).toHaveBeenCalledTimes(1);
      expect(stopBackupAuditPolling).not.toHaveBeenCalled();
    });

    unmount();

    expect(stopBackupAuditPolling).toHaveBeenCalledTimes(1);
  });

  it("keeps deprecation summary polling active when the summary store updates", async () => {
    const { unmount } = render((await import("./deprecation-scan-summary.svelte")).default, {
      props: { clusterId: "cluster-a" },
    });

    await waitFor(() => {
      expect(startDeprecationScanPolling).toHaveBeenCalledTimes(1);
      expect(runDeprecationScan).toHaveBeenCalledTimes(1);
    });

    deprecationScanState.set({
      "cluster-a": {
        summary: { status: "ok", message: "No deprecated APIs" },
      },
    });

    await waitFor(() => {
      expect(startDeprecationScanPolling).toHaveBeenCalledTimes(1);
      expect(stopDeprecationScanPolling).not.toHaveBeenCalled();
    });

    unmount();

    expect(stopDeprecationScanPolling).toHaveBeenCalledTimes(1);
  });
});
