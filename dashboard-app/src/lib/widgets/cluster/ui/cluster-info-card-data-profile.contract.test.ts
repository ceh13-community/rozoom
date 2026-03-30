import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/widgets/cluster/ui/cluster-info-card.svelte"), "utf8");

describe("cluster info card data profile contract", () => {
  it("gates global watcher startup by dashboard diagnostics policy and card budget", () => {
    expect(source).toContain('from "$shared/lib/dashboard-data-profile.svelte"');
    expect(source).toContain("autoRefreshActive?: boolean;");
    expect(source).toContain(
      "const autoDiagnosticsEnabled = $derived(shouldAutoRunDiagnostics($dashboardDataProfile));",
    );
    expect(source).toContain("if (!autoRefreshActive || !autoDiagnosticsEnabled) {");
    expect(source).toContain("stopGlobalWatcher(cluster.uuid);");
    expect(source).toContain("const shouldStartWatcherImmediately = $derived.by(");
    expect(source).toContain("let healthCheckHydrated = $state(false);");
    expect(source).toContain("healthCheckHydrated = true;");
    expect(source).toContain("if (!healthCheckHydrated) return;");
    expect(source).toContain(
      "startGlobalWatcher(cluster.uuid, refreshIntervalMs, shouldStartWatcherImmediately);",
    );
    expect(source).toContain("const showInitialRefreshHint = $derived(");
    expect(source).toContain("const showInitialRefreshButton = $derived(");
    expect(source).toContain("const canShowConfigDiagnostics = $derived(");
    expect(source).toContain("const canShowHealthDiagnostics = $derived(");
    expect(source).toContain("!cluster.needsInitialRefreshHint &&");
    expect(source).toContain("if (cluster.needsInitialRefreshHint) {");
    expect(source).toContain("void markClusterRefreshHintSeen(cluster.uuid);");
    expect(source).toContain(
      "const awaitingInitialRefresh = $derived(Boolean(cluster.needsInitialRefreshHint) && !lastCheck);",
    );
    expect(source).toContain("const displayClusterCardColor = $derived.by(() =>");
    expect(source).toContain("let refreshUiLoading = $state(false);");
    expect(source).toContain(
      "const isRefreshLoading = $derived(checkState.loading || refreshUiLoading);",
    );
    expect(source).toContain("if (isRefreshLoading) {");
    expect(source).toContain("manualRefreshPending = true;");
    expect(source).toContain("const metricsEndpoints = $derived.by(() => {");
    expect(source).toContain("function parseSummaryTimestamp(");
    expect(source).toContain("function isPersistedSummaryNewer(");
    expect(source).toContain("const activeAlertsCount = $derived.by(");
    expect(source).toContain("persistedAlertsSummary.activeCount");
    expect(source).toContain("const metricsAvailableCount = $derived.by(");
    expect(source).toContain("persistedMetricsSummary.availableCount");
    expect(source).toContain("const metricsTotalCount = $derived.by(() => {");
    expect(source).toContain("persistedMetricsSummary.totalCount");
    expect(source).toContain(
      "if (metricsState?.checks?.length && !preferPersistedMetricsSummary) {",
    );
    expect(source).toContain("function parseMetricsEndpointStatus(");
    expect(source).toContain("return (entry as { result?: unknown }).result === 1;");
    expect(source).toContain(
      "return Object.values(lastCheck.metricsChecks?.endpoints ?? {}).map((endpoint) => ({",
    );
    expect(source).toContain("status: parseMetricsEndpointStatus(endpoint?.status),");
    expect(source).toContain(
      'import ClusterRuntimeTuningPanel from "./cluster-runtime-tuning-panel.svelte";',
    );
    expect(source).toContain("<ClusterRuntimeTuningPanel clusterId={cluster.uuid} />");
    expect(source).toContain('import { deprecationScanState } from "$features/deprecation-scan";');
    expect(source).toContain('import { versionAuditState } from "$features/version-audit";');
    expect(source).toContain('import { backupAuditState } from "$features/backup-audit";');
    expect(source).toContain("const deprecationSummary = $derived(");
    expect(source).toContain("$deprecationScanState[cluster.uuid]?.summary ?? null");
    expect(source).toContain("const versionSummary = $derived(");
    expect(source).toContain("$versionAuditState[cluster.uuid]?.summary ?? null");
    expect(source).toContain("const backupSummary = $derived(");
    expect(source).toContain("$backupAuditState[cluster.uuid]?.summary ?? null");
    expect(source).toContain("lastCheck.armorSummary");
    expect(source).toContain("lastCheck.complianceSummary.findingCount");
    expect(source).toContain("lastCheck.trivySummary");
    expect(source).toContain("{#if cluster.needsInitialRefreshHint}");
    expect(source).toContain("Summary widgets will activate after the first manual refresh.");
    expect(source).toContain("disabled={isRefreshLoading}");
    expect(source).toContain("cursor-not-allowed opacity-70");
    expect(source).toContain("<Refresh");
    expect(source).toContain("animate-spin");
    expect(source).toContain("animate-bounce");
    expect(source).toContain("Configuration diagnostics are not loaded yet.");
    expect(source).toContain("Health diagnostics are not loaded yet.");
    expect(source).toContain('onclick={() => requestCardDiagnostics("config")}');
    expect(source).toContain('onclick={() => requestCardDiagnostics("health")}');
    expect(source).toContain("resolveClusterRuntimeBudgetForCluster(cluster.uuid)");
    expect(source).toContain("Queued by policy");
    expect(source).toContain("Loading<LoadingDots />");
  });
});
