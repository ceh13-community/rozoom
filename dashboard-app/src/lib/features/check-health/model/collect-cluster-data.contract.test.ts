import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/features/check-health/model/collect-cluster-data.ts"),
  "utf8",
);

describe("collect cluster data contract", () => {
  it("guards metrics-server availability against partial cached endpoint payloads", () => {
    expect(source).toContain(
      "function isMetricsServerAvailable(metricsChecks: MetricsChecks | null | undefined): boolean",
    );
    expect(source).toContain("const status = metricsChecks?.endpoints.metrics_server.status;");
    expect(source).toContain('if (Array.isArray(status)) return status.includes("Available");');
    expect(source).toContain('return typeof status === "string" && status.includes("Available");');
    expect(source).not.toContain(
      'metricsChecks.endpoints.metrics_server.status.includes("Available")',
    );
  });

  it("normalizes partial entity payloads before reading .items.length", () => {
    expect(source).toContain(
      "function entityItems<T>(value: { items?: T[] } | null | undefined): T[] {",
    );
    expect(source).toContain(
      "function ensureEntityBag<T extends { items?: unknown[] }>(value: T): T {",
    );
    expect(source).toContain(
      "function normalizeLoadedClusterData(loadedData: ClusterData): ClusterData {",
    );
    expect(source).toContain("const normalizedData = normalizeLoadedClusterData(loadedData);");
    expect(source).toContain("const podItems = entityItems(normalizedData.pods);");
    expect(source).toContain("const daemonSetItems = entityItems(normalizedData.daemonsets);");
    expect(source).toContain("const deploymentItems = entityItems(normalizedData.deployments);");
    expect(source).toContain("const nodeItems = entityItems(normalizedData.nodes);");
    expect(source).toContain("pods: podItems.length || 0,");
    expect(source).toContain("daemonSets: usePreviousDaemonSets");
    expect(source).toContain(": daemonSetItems.length || 0,");
    expect(source).toContain(": parseNodes({ ...normalizedData.nodes, items: nodeItems }),");
  });
});
