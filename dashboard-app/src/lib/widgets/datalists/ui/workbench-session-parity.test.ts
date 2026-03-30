import { describe, expect, it } from "vitest";
import { parsePodsWorkbenchState } from "./pods-list/workbench-session";
import { parseDeploymentsWorkbenchState } from "./deployments-list/workbench-session";
import { parseDaemonSetsWorkbenchState } from "./daemon-sets-list/workbench-session";

describe("workbench session parser parity", () => {
  it("normalizes shared logs/yaml payload consistently for pods/deployments/daemonsets", () => {
    const payload = JSON.stringify({
      version: 1,
      tabs: [
        { kind: "logs", name: "api", namespace: "prod", pinned: 1 },
        { kind: "yaml", name: "api", namespace: "prod", pinned: 0 },
        { kind: "unknown", name: "x", namespace: "y", pinned: true },
      ],
      activeTabId: "logs:prod/api",
      layout: "dual",
      paneTabIds: ["logs:prod/api", "yaml:prod/api", { bad: true }],
      collapsedPaneIndexes: [0, 1, -1, 1.5],
      closedTabs: [
        { kind: "logs", target: { name: "api", namespace: "prod" }, pinned: true },
        { kind: "yaml", target: null, pinned: false },
        { kind: "invalid", target: { name: "x", namespace: "y" }, pinned: false },
      ],
      workbenchCollapsed: "false",
      workbenchFullscreen: "true",
    });

    const pods = parsePodsWorkbenchState(payload);
    const deployments = parseDeploymentsWorkbenchState(payload);
    const daemonsets = parseDaemonSetsWorkbenchState(payload);

    expect(pods).not.toBeNull();
    expect(deployments).not.toBeNull();
    expect(daemonsets).not.toBeNull();

    const sharedPods = {
      tabs: pods?.tabs.filter((tab) => tab.kind === "logs" || tab.kind === "yaml"),
      activeTabId: pods?.activeTabId,
      layout: pods?.layout,
      paneTabIds: pods?.paneTabIds,
      collapsedPaneIndexes: pods?.collapsedPaneIndexes,
      closedTabs: pods?.closedTabs.filter((tab) => tab.kind === "logs" || tab.kind === "yaml"),
      workbenchCollapsed: pods?.workbenchCollapsed,
      workbenchFullscreen: pods?.workbenchFullscreen,
    };

    const sharedDeployments = {
      tabs: deployments?.tabs,
      activeTabId: deployments?.activeTabId,
      layout: deployments?.layout,
      paneTabIds: deployments?.paneTabIds,
      collapsedPaneIndexes: deployments?.collapsedPaneIndexes,
      closedTabs: deployments?.closedTabs,
      workbenchCollapsed: deployments?.workbenchCollapsed,
      workbenchFullscreen: deployments?.workbenchFullscreen,
    };

    const sharedDaemonSets = {
      tabs: daemonsets?.tabs,
      activeTabId: daemonsets?.activeTabId,
      layout: daemonsets?.layout,
      paneTabIds: daemonsets?.paneTabIds,
      collapsedPaneIndexes: daemonsets?.collapsedPaneIndexes,
      closedTabs: daemonsets?.closedTabs,
      workbenchCollapsed: daemonsets?.workbenchCollapsed,
      workbenchFullscreen: daemonsets?.workbenchFullscreen,
    };

    expect(sharedDeployments).toEqual(sharedPods);
    expect(sharedDaemonSets).toEqual(sharedPods);
  });
});
