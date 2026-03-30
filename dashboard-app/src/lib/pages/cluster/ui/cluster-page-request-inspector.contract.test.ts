import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/pages/cluster/ui/cluster-page.svelte"), "utf8");
const runtimeSource = readFileSync(
  resolve("src/lib/pages/cluster/model/cluster-page-runtime.ts"),
  "utf8",
);

describe("cluster page request inspector contract", () => {
  it("keeps the request/debug inspector available from the cluster header", () => {
    expect(runtimeSource).toContain("export function buildClusterRequestInspector");
    expect(runtimeSource).toContain("listPortForwardTelemetryEvents");
    expect(source).toContain(
      'import ClusterRequestDebugInspector from "$widgets/cluster/ui/cluster-request-debug-inspector.svelte";',
    );
    expect(source).toContain("const clusterRequestInspector = $derived.by(() => {");
    expect(source).toContain('title="Open request and debug inspector"');
    expect(source).toContain("<ClusterRequestDebugInspector");
  });
});
