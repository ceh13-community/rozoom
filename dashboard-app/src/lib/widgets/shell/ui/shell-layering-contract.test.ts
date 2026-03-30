import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("shell/workbench layering contract", () => {
  it("keeps shell windows above workbench fullscreen and namespace controls", () => {
    const shellWindow = read("src/lib/widgets/shell/ui/shell-window.svelte");
    const namespaceSelect = read("src/lib/widgets/namespace/ui/namespace-select.svelte");
    const multiPaneWorkbench = read("src/lib/shared/ui/multi-pane-workbench.svelte");
    const daemonSetsList = read("src/lib/widgets/datalists/ui/daemon-sets-list.svelte");

    expect(shellWindow).toContain("z-[180]");
    expect(namespaceSelect).toContain("z-[95]");
    expect(multiPaneWorkbench).toContain("fixed inset-0 z-[120]");
    expect(daemonSetsList).toContain("fixed inset-0 z-[120]");
    expect(multiPaneWorkbench).toContain("relative z-[100]");
    expect(daemonSetsList).toContain("relative z-[100]");
  });

  it("keeps debug describe in a dedicated read-only shell mode", () => {
    const shellWindow = read("src/lib/widgets/shell/ui/shell-window.svelte");

    expect(shellWindow).toContain("Debug describe");
    expect(shellWindow).toContain("Copy output");
    expect(shellWindow).toContain("Copy command");
    expect(shellWindow).toContain("Export output");
    expect(shellWindow).toContain("Rerun");
  });

  it("uses the shared destructive confirm flow for shell close actions", () => {
    const shellWindow = read("src/lib/widgets/shell/ui/shell-window.svelte");

    expect(shellWindow).toContain('import { confirmAction } from "$shared/lib/confirm-action";');
    expect(shellWindow).toContain("await confirmAction(");
    expect(shellWindow).not.toContain("async function confirmDeletion(");
    expect(shellWindow).not.toContain("import { confirm as tauriConfirm }");
  });
});
