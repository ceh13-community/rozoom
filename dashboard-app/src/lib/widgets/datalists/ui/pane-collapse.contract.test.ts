import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(__dirname, file), "utf8");

// A pane's collapse button shows only while another pane stays open to take the space.
// With one pane, or with the other pane already collapsed, the click did nothing.
describe("pane collapse button", () => {
  it.each([
    "deployments-list.svelte",
    "daemon-sets-list.svelte",
    "stateful-sets-list.svelte",
    "replica-sets-list.svelte",
    "jobs-list.svelte",
    "cron-jobs-list.svelte",
    "configuration-list.svelte",
    "nodes-list/nodes-statuses-list.svelte",
    "workload-simple-workbench.svelte",
  ])("%s counts the panes that stay open", (file) => {
    const source = read(file);
    expect(source).not.toContain("canVerticalCollapse={getPaneCount() > 1}");
    expect(source).toContain(
      "canVerticalCollapse={getPaneCount() - collapsedPaneIndexes.length > 1}",
    );
  });

  it("pod panes ask the panel instead of always showing the button", () => {
    const pane = read("pods-list/pod-workbench-pane.svelte");
    const panel = read("pods-list/pod-workbench-panel.svelte");
    expect(pane).not.toContain("canVerticalCollapse={true}");
    expect(pane).toContain("canVerticalCollapse={canVerticalCollapse || isVerticallyCollapsed}");
    expect(panel).toContain("canVerticalCollapse={canCollapseExpandedPane(paneIndex)}");
    expect(panel).toMatch(
      /function canCollapseExpandedPane[\s\S]*?paneCount - collapsedPaneIndexes\.length > 1/,
    );
  });

  it.each([
    "deployments-list.svelte",
    "daemon-sets-list.svelte",
    "stateful-sets-list.svelte",
    "replica-sets-list.svelte",
    "jobs-list.svelte",
    "cron-jobs-list.svelte",
    "configuration-list.svelte",
    "nodes-list/nodes-statuses-list.svelte",
    "pods-list/pod-workbench-panel.svelte",
    "workload-simple-workbench.svelte",
  ])("%s does not undo a collapse while Realtime is on", (file) => {
    const source = read(file);
    expect(source).not.toMatch(/id !== "realtime"\) return;\s*if \(workbenchCollapsed\)/);
    expect(source).toContain("expandWorkbenchOnRealtimeSwitch(");
  });
});
