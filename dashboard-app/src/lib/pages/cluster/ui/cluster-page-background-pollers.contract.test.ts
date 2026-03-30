import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/pages/cluster/ui/cluster-page.svelte"), "utf8");
const runtimeSource = readFileSync(
  resolve("src/lib/pages/cluster/model/cluster-page-runtime.ts"),
  "utf8",
);

describe("cluster page background pollers contract", () => {
  it("stops dashboard and summary pollers when entering a cluster detail page", () => {
    expect(runtimeSource).toContain("export function stopClusterDetailBackgroundPollers(");
    expect(runtimeSource).toContain("stopGlobalWatcher(clusterId);");
    expect(runtimeSource).toContain("stopNodesHealthPolling(clusterId);");
    expect(runtimeSource).toContain("stopMetricsSourcesPolling(clusterId);");
    expect(runtimeSource).toContain("stopBackupAuditPolling(clusterId);");
    expect(runtimeSource).toContain("stopVersionAuditPolling(clusterId);");
    expect(runtimeSource).toContain("stopDeprecationScanPolling(clusterId);");
    expect(runtimeSource).toContain("stopAlertHubPolling(clusterId);");
    expect(runtimeSource).toContain("stopArmorHubPolling(clusterId);");
    expect(runtimeSource).toContain("stopComplianceHubPolling(clusterId);");
    expect(source).toContain("stopClusterDetailBackgroundPollers(cluster);");
  });
});
