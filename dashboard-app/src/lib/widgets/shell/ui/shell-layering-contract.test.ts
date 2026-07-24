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

  it("renders cluster action panels and workbench fullscreen above the shell terminal", () => {
    const clusterPanels = [
      "src/lib/widgets/cluster/ui/auth-security-panel.svelte",
      "src/lib/widgets/cluster/ui/rotate-certs-panel.svelte",
      "src/lib/widgets/cluster/ui/gitops-bootstrap-panel.svelte",
      "src/lib/widgets/cluster/ui/helm-panel.svelte",
      "src/lib/widgets/cluster/ui/helm-catalog-panel.svelte",
    ];

    // Shell windows sit at z-[180]; safety-critical cluster dialogs must layer above it.
    for (const path of clusterPanels) {
      const source = read(path);
      expect(source, `${path} overlay must sit above shell terminal`).toContain(
        "z-[190] bg-black/40",
      );
      expect(source, `${path} content must sit above shell terminal`).toContain(
        "right-6 z-[195] flex",
      );
      expect(source, `${path} must not keep the old below-shell z-index`).not.toContain("z-[150]");
      expect(source, `${path} must not keep the old below-shell z-index`).not.toContain("z-[160]");
    }

    const workbenchShell = read("src/lib/widgets/datalists/ui/common/workbench-sheet-shell.svelte");
    expect(workbenchShell).toContain("fixed inset-3 z-[195]");
    expect(workbenchShell).not.toContain("z-[170]");
  });

  it("dims the viewport behind the details sheet portal", () => {
    const detailsPortal = read("src/lib/shared/ui/details-sheet-portal.svelte");
    expect(detailsPortal).toContain("z-[190] bg-black/80");
    expect(detailsPortal).not.toContain("bg-black/20");
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
