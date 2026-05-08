import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/widgets/datalists/ui/overview.svelte"), "utf8");

describe("overview watcher optimizations contract", () => {
  it("throttles heavy usage metrics refresh cadence and runs heavy branch by TTL", () => {
    expect(source).toContain("const USAGE_METRICS_REFRESH_MS = 180_000;");
    expect(source).toContain("function shouldRefreshUsageMetrics(options?: { force?: boolean })");
    expect(source).toContain("Date.now() - usageMetricsLastLoadedAt >= USAGE_METRICS_REFRESH_MS");
    expect(source).toContain("if (!shouldRefreshUsageMetrics(options)) {");
    expect(source).toContain("async function loadUsageMetrics(");
    expect(source).toContain("token: RefreshRunToken = activeRefreshToken,");
  });

  it("guards async updates with a unified cancellation token", () => {
    expect(source).toContain("type RefreshRunToken = {");
    expect(source).toContain("let activeRefreshToken: RefreshRunToken = createRefreshToken();");
    expect(source).toContain("function rotateRefreshToken()");
    expect(source).toContain(
      "function isRefreshTokenActive(token: RefreshRunToken, clusterId: string)",
    );
    expect(source).toContain("if (!isRefreshTokenActive(token, clusterId)) return;");
  });

  it("reinitializes overview sync state when active cluster slug or scope changes", () => {
    expect(source).toContain("let activeOverviewClusterId = $state<string | null>(null);");
    expect(source).toContain("let activeOverviewScopeKey = $state<string | null>(null);");
    expect(source).toContain("const scopeKey = clusterId ? getOverviewScopeKey() : null;");
    expect(source).toContain(
      "if (clusterId === activeOverviewClusterId && scopeKey === activeOverviewScopeKey) return;",
    );
    expect(source).toContain("cancelRefreshToken(activeRefreshToken);");
    expect(source).toContain("activeRefreshToken = createRefreshToken();");
    expect(source).toContain("if (previousClusterId && previousClusterId !== clusterId) {");
    expect(source).toContain("if (previousScopeKey && previousScopeKey !== scopeKey) {");
    expect(source).toContain("activateOverviewCluster(clusterId, scopeKey);");
  });
});
