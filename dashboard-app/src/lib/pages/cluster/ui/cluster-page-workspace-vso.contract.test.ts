import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/pages/cluster/ui/cluster-page.svelte"), "utf8");
const workspaceSource = readFileSync(
  resolve("src/lib/pages/cluster/model/cluster-page-workspace.ts"),
  "utf8",
);
const debugSource = readFileSync(
  resolve("src/lib/pages/cluster/model/cluster-page-debug.ts"),
  "utf8",
);
const effectsSource = readFileSync(
  resolve("src/lib/pages/cluster/model/cluster-page-effects.ts"),
  "utf8",
);

describe("cluster page workspace VSO contract", () => {
  it("persists split layout and pane state in localStorage", () => {
    expect(source).toContain(
      'const WORKSPACE_LAYOUT_KEY = "dashboard.cluster.workspace-layout.v1"',
    );
    expect(source).toContain('const WORKSPACE_PANES_KEY = "dashboard.cluster.workspace-panes.v1"');
    expect(source).toContain("workspaceLayout = readWorkspaceLayout(WORKSPACE_LAYOUT_KEY);");
    expect(source).toContain("normalizeWorkspacePanes(");
    expect(source).toContain(
      "readWorkspacePanes(WORKSPACE_PANES_KEY, createDefaultWorkspacePanes())",
    );
    expect(source).toContain(
      'const PINNED_WORKSPACE_SESSIONS_KEY = "dashboard.cluster.pinned-workspace-sessions.v1"',
    );
    expect(source).toContain("pinnedWorkspaceSessions = readPinnedWorkspaceSessions(");
    expect(workspaceSource).toContain("window.localStorage.setItem(storageKey, String(next));");
    expect(workspaceSource).toContain(
      "window.localStorage.setItem(storageKey, JSON.stringify(next));",
    );
  });

  it("keeps three-pane workspace model with Pane A/B/C sections", () => {
    expect(workspaceSource).toContain(
      'export type WorkspacePaneId = "pane-1" | "pane-2" | "pane-3";',
    );
    expect(workspaceSource).toContain(
      'export const WORKSPACE_PANE_IDS: WorkspacePaneId[] = ["pane-1", "pane-2", "pane-3"];',
    );
    expect(source).toContain('{paneIndexLabel("pane-1")}');
    expect(source).toContain('{paneIndexLabel("pane-2")}');
    expect(source).toContain('{paneIndexLabel("pane-3")}');
    expect(source).not.toContain('aria-label="Pane B tabs"');
    expect(source).not.toContain('aria-label="Pane C tabs"');
    expect(source).not.toContain('draggable="true"');
  });

  it("supports independent pane clusters and routes pane-1 tab actions", () => {
    expect(source).toContain("clusterUuid: cluster,");
    expect(source).toContain("clusterUuid: pane.clusterId || cluster,");
    expect(source).toContain("function setPaneCluster(paneId: WorkspacePaneId, clusterId: string)");
    expect(source).toContain("clusterId: tab.clusterId");
    expect(source).toContain(
      'toClusterWorkloadHref(tab.workload, tab.sortField || "name", tab.clusterId)',
    );
    expect(source).toContain('if (paneId === "pane-1") {');
    expect(source).toContain("void gotoFromWorkspace(toClusterWorkloadHref(");
    expect(source).toContain('if (targetPaneId === "pane-1") {');
  });

  it("binds pane cluster selectors to pane state and not only route cluster", () => {
    expect(source).toContain("value={pane.clusterId || cluster}");
    expect(source).toContain(
      'setPaneCluster("pane-2", (event.currentTarget as HTMLSelectElement).value)',
    );
    expect(source).toContain(
      'setPaneCluster("pane-3", (event.currentTarget as HTMLSelectElement).value)',
    );
    expect(source).toContain("clusterId={pane.clusterId || cluster}");
    expect(source).toContain("syncBadgeTone(pane.workload, pane.clusterId || cluster)");
  });

  it("resets non-pinned pages to single-pane only on external navigation", () => {
    expect(source).toContain("let preserveNextSinglePaneReset = $state(false);");
    expect(source).toContain("async function gotoFromWorkspace(href: string)");
    expect(source).toContain("preserveNextSinglePaneReset = true;");
    expect(source).toContain('if (preserveNextSinglePaneReset || navSource === "workspace") {');
    expect(source).toContain("preserveNextSinglePaneReset = false;");
    expect(source).toContain(
      "const navSource = resolveWorkspaceNavigationSource(nextNavigationSource);",
    );
    expect(effectsSource).toContain(
      'return nextNavigationSource === "workspace" ? "workspace" : "left_menu";',
    );
    expect(source).toContain("transientWorkspaceLayout = 1;");
    expect(source).toContain(
      "const effectiveWorkspaceLayout = $derived(\n    isCurrentTabPinned ? workspaceLayout : transientWorkspaceLayout,",
    );
  });

  it("shows workspace transparency affordances and route trace tools", () => {
    expect(source).toContain(
      'const workspaceLayoutMode = $derived(isCurrentTabPinned ? "pinned" : "temporary");',
    );
    expect(source).toContain("const workspaceModeLabel = $derived(");
    expect(source).toContain("Restore pinned layout");
    expect(source).toContain("function workspaceLayoutBadge(tabId: string): string");
    expect(debugSource).toContain("export function workspaceLayoutBadge(");
    expect(source).toContain("Copy Route Trace");
    expect(source).toContain("nav_source: {lastNavigationSource}");
    expect(source).toContain("layout_mode: {workspaceLayoutMode}");
    expect(source).toContain("function pushRouteTrace(source: ");
    expect(debugSource).toContain("export function buildRouteTraceEntry(");
    expect(source).toContain("function copyWorkspaceRouteTrace()");
  });

  it("guards pin removal for split sessions and shows single-page hint once", () => {
    expect(source).toContain(
      'const SINGLE_PAGE_HINT_SHOWN_KEY = "dashboard.cluster.single-page-hint-shown.v1"',
    );
    expect(source).toContain(
      "async function shouldConfirmPinnedRemoval(tabId: string): Promise<boolean>",
    );
    expect(source).toContain('import { confirmAction } from "$shared/lib/confirm-action";');
    expect(source).toContain("await confirmAction(");
    expect(source).toContain("function showSinglePageHintOnce()");
    expect(source).toContain('window.localStorage.setItem(SINGLE_PAGE_HINT_SHOWN_KEY, "1");');
    expect(source).toContain('toast("You are viewing a standalone page.');
  });

  it("persists effective layout when pinning from temporary workspace mode", () => {
    expect(source).toContain("function persistPinnedWorkspaceSession(tabId: string)");
    expect(source).toContain("layout: effectiveWorkspaceLayout,");
  });

  it("exposes minimal debug helpers for pane status and snapshot copy", () => {
    expect(source).toContain(
      'function paneStatusLabel(paneId: WorkspacePaneId): "loading" | "error" | "ready"',
    );
    expect(source).toContain("function copyWorkspaceDebugState()");
    expect(debugSource).toContain("export function buildWorkspaceDebugSnapshot(");
    expect(source).toContain("await navigator.clipboard.writeText(payload);");
    expect(source).toContain('{copiedDebugState ? "Copied" : "Debug"}');
    expect(source).toContain('Status: {paneStatusLabel("pane-1")}');
    expect(source).toContain('Status: {paneStatusLabel("pane-2")}');
    expect(source).toContain('Status: {paneStatusLabel("pane-3")}');
  });
});
