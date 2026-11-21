import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(__dirname, file), "utf8");

// Scale looked different per workload: Deployments had an in-app dialog, StatefulSets and
// ReplicaSets a system prompt titled "JavaScript - tauri://localhost/...".
describe("one scale dialog for every workload", () => {
  it.each([
    ["deployments-list.svelte", 'resourceKind="Deployment"'],
    ["stateful-sets-list.svelte", 'resourceKind="StatefulSet"'],
    ["replica-sets-list.svelte", 'resourceKind="ReplicaSet"'],
  ])("%s scales through ScaleDialog", (file, kind) => {
    const source = read(file);
    expect(source).toContain('import ScaleDialog from "$shared/ui/scale-dialog.svelte";');
    expect(source).toContain("<ScaleDialog");
    expect(source).toContain(kind);
    expect(source).not.toContain("requestReplicaCount");
  });

  it("starts a Network > Port Forwarding forward without the start-mode prompt", () => {
    const panel = read("network/port-forwarding-panel.svelte");
    expect(panel).not.toContain("requestPortForwardStartMode");
    expect(panel).toContain('const startMode = openAfterStart ? "start-and-open" : "start-only";');
    expect(panel).toContain("Open the page after it starts");
  });
});
