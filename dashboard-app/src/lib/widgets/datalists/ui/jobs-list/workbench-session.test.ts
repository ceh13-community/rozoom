import { describe, expect, it } from "vitest";
import { getJobsWorkbenchStateKey, parseJobsWorkbenchState } from "./workbench-session";

describe("jobs workbench session", () => {
  it("builds stable localStorage key", () => {
    expect(getJobsWorkbenchStateKey("cluster-a")).toBe(
      "dashboard.jobs.workbench.state.v1:cluster-a",
    );
  });

  it("returns null for invalid payload", () => {
    expect(parseJobsWorkbenchState(null)).toBeNull();
    expect(parseJobsWorkbenchState("bad-json")).toBeNull();
    expect(parseJobsWorkbenchState(JSON.stringify({ version: 2 }))).toBeNull();
  });

  it("normalizes and keeps valid state", () => {
    const parsed = parseJobsWorkbenchState(
      JSON.stringify({
        version: 1,
        tabs: [
          { kind: "logs", name: "aws-node", namespace: "kube-system", pinned: true },
          { kind: "yaml", name: "aws-node", namespace: "kube-system", pinned: false },
          { kind: "events", name: "bad", namespace: "kube-system" },
        ],
        activeTabId: "logs:kube-system/aws-node",
        layout: "triple",
        paneTabIds: ["logs:kube-system/aws-node", "yaml:kube-system/aws-node", {}],
        collapsedPaneIndexes: [0, 2, -1],
        closedTabs: [
          { kind: "yaml", target: { name: "aws-node", namespace: "kube-system" }, pinned: true },
          { kind: "bad", target: null, pinned: false },
        ],
        workbenchCollapsed: 0,
        workbenchFullscreen: 1,
      }),
    );

    expect(parsed).toEqual({
      version: 1,
      tabs: [
        { kind: "logs", name: "aws-node", namespace: "kube-system", pinned: true },
        { kind: "yaml", name: "aws-node", namespace: "kube-system", pinned: false },
      ],
      activeTabId: "logs:kube-system/aws-node",
      layout: "triple",
      paneTabIds: ["logs:kube-system/aws-node", "yaml:kube-system/aws-node", null],
      collapsedPaneIndexes: [0, 2],
      closedTabs: [
        { kind: "yaml", target: { name: "aws-node", namespace: "kube-system" }, pinned: true },
      ],
      workbenchCollapsed: false,
      workbenchFullscreen: true,
    });
  });
});
