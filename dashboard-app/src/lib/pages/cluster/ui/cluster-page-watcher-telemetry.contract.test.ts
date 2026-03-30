import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/pages/cluster/ui/cluster-page.svelte"), "utf8");
const runtimeSource = readFileSync(
  resolve("src/lib/pages/cluster/model/cluster-page-runtime.ts"),
  "utf8",
);

describe("cluster page watcher telemetry contract", () => {
  it("renders watcher health telemetry inside the debug panel", () => {
    expect(runtimeSource).toContain("getWatcherTelemetrySummary");
    expect(runtimeSource).toContain("listWatcherTelemetryClusterRows");
    expect(source).toContain("const watcherTelemetrySummary = $derived.by(() => {");
    expect(source).toContain("const watcherTelemetryRows = $derived.by(() => {");
    expect(runtimeSource).toContain("const recent = events.slice(-500);");
    expect(runtimeSource).toContain("const recent = events.slice(-1200);");
    expect(runtimeSource).toContain(".slice(0, 12);");
    expect(source).toContain("watcher events:");
    expect(source).toContain("Watcher health view");
    expect(source).toContain("No watcher telemetry yet");
  });
});
