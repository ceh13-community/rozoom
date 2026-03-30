import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/pages/cluster/ui/cluster-page.svelte"), "utf8");
const runtimeSource = readFileSync(
  resolve("src/lib/pages/cluster/model/cluster-page-runtime.ts"),
  "utf8",
);
const managerSource = readFileSync(
  resolve("src/lib/shared/lib/cluster-runtime-manager.ts"),
  "utf8",
);

describe("cluster page adaptive connectivity contract", () => {
  it("keeps adaptive connectivity degradation wired from runtime telemetry into cluster runtime state", () => {
    expect(runtimeSource).toContain("export function buildAdaptiveConnectivityState");
    expect(managerSource).toContain("export function setClusterRuntimeDegraded");
    expect(source).toContain("const adaptiveConnectivityState = $derived.by(() => {");
    expect(source).toContain(
      "setClusterRuntimeDegraded(cluster, adaptiveConnectivityState.active);",
    );
    expect(source).toContain("Adaptive connectivity:");
    expect(source).toContain("adaptiveConnectivityState.reason");
    expect(source).toContain("const clusterTrustBanner = $derived.by(() => {");
    expect(source).toContain("buildClusterTrustBannerModel");
    expect(runtimeSource).toContain("export function buildClusterTrustBannerModel");
    expect(runtimeSource).toContain("Cluster runtime is recovering");
    expect(runtimeSource).toContain("Cluster is serving stale cached data");
  });
});
