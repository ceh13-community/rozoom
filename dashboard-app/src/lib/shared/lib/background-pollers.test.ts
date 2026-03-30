import { beforeEach, describe, expect, it, vi } from "vitest";

const stopAllWatchers = vi.fn();
const stopAllNodesHealthPolling = vi.fn();
const resetActiveApiSyncClusters = vi.fn();
const stopAllMetricsSourcesPolling = vi.fn();
const stopAllBackupAuditPolling = vi.fn();
const stopAllVersionAuditPolling = vi.fn();
const stopAllDeprecationScanPolling = vi.fn();
const stopAllAlertHubPolling = vi.fn();
const stopAllArmorHubPolling = vi.fn();
const stopAllComplianceHubPolling = vi.fn();
const stopNamespaceActivity = vi.fn();

vi.mock("$features/check-health", () => ({
  stopAllNodesHealthPolling,
}));

vi.mock("$features/check-health/model/watchers", () => ({
  stopAllWatchers,
}));

vi.mock("$features/check-health/model/api-sync/api-sync-activity", () => ({
  resetActiveApiSyncClusters,
}));

vi.mock("$features/metrics-sources", () => ({
  stopAllMetricsSourcesPolling,
}));

vi.mock("$features/backup-audit", () => ({
  stopAllBackupAuditPolling,
}));

vi.mock("$features/version-audit", () => ({
  stopAllVersionAuditPolling,
}));

vi.mock("$features/deprecation-scan", () => ({
  stopAllDeprecationScanPolling,
}));

vi.mock("$features/alerts-hub", () => ({
  stopAllAlertHubPolling,
}));

vi.mock("$features/armor-hub", () => ({
  stopAllArmorHubPolling,
}));

vi.mock("$features/compliance-hub", () => ({
  stopAllComplianceHubPolling,
}));

vi.mock("$features/namespace-management", () => ({
  stopNamespaceActivity,
}));

describe("stopAllBackgroundPollers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("stops route-scoped sync, pollers, and namespace activity", async () => {
    const { stopAllBackgroundPollers } = await import("./background-pollers");

    stopAllBackgroundPollers();

    expect(resetActiveApiSyncClusters).toHaveBeenCalledTimes(1);
    expect(stopAllWatchers).toHaveBeenCalledTimes(1);
    expect(stopAllNodesHealthPolling).toHaveBeenCalledTimes(1);
    expect(stopAllMetricsSourcesPolling).toHaveBeenCalledTimes(1);
    expect(stopAllBackupAuditPolling).toHaveBeenCalledTimes(1);
    expect(stopAllVersionAuditPolling).toHaveBeenCalledTimes(1);
    expect(stopAllDeprecationScanPolling).toHaveBeenCalledTimes(1);
    expect(stopAllAlertHubPolling).toHaveBeenCalledTimes(1);
    expect(stopAllArmorHubPolling).toHaveBeenCalledTimes(1);
    expect(stopAllComplianceHubPolling).toHaveBeenCalledTimes(1);
    expect(stopNamespaceActivity).toHaveBeenCalledTimes(1);
  });
});
