import { describe, expect, it } from "vitest";
import {
  getDeploymentsWorkbenchStateKey,
  parseDeploymentsWorkbenchState,
} from "./workbench-session";

describe("deployments workbench session", () => {
  it("builds stable localStorage key", () => {
    expect(getDeploymentsWorkbenchStateKey("cluster-a")).toBe(
      "dashboard.deployments.workbench.state.v1:cluster-a",
    );
  });

  it("returns null for invalid payload", () => {
    expect(parseDeploymentsWorkbenchState(null)).toBeNull();
    expect(parseDeploymentsWorkbenchState("not-json")).toBeNull();
    expect(parseDeploymentsWorkbenchState(JSON.stringify({ version: 2 }))).toBeNull();
  });

  it("normalizes and keeps valid state", () => {
    const parsed = parseDeploymentsWorkbenchState(
      JSON.stringify({
        version: 1,
        tabs: [
          { kind: "logs", name: "api", namespace: "prod", pinned: 1 },
          { kind: "yaml", name: "web", namespace: "prod", pinned: false },
          { kind: "events", name: "bad", namespace: "prod" },
        ],
        activeTabId: "logs:prod/api",
        layout: "dual",
        paneTabIds: ["logs:prod/api", "yaml:prod/web", 1],
        collapsedPaneIndexes: [0, 1, -1, 1.5],
        closedTabs: [
          { kind: "logs", target: { name: "api", namespace: "prod" }, pinned: true },
          { kind: "yaml", target: null, pinned: false },
          { kind: "events", target: { name: "x", namespace: "y" } },
        ],
        workbenchCollapsed: 1,
        workbenchFullscreen: "yes",
      }),
    );

    expect(parsed).toEqual({
      version: 1,
      tabs: [
        { kind: "logs", name: "api", namespace: "prod", pinned: true },
        { kind: "yaml", name: "web", namespace: "prod", pinned: false },
        { kind: "events", name: "bad", namespace: "prod", pinned: false },
      ],
      activeTabId: "logs:prod/api",
      layout: "dual",
      paneTabIds: ["logs:prod/api", "yaml:prod/web", null],
      collapsedPaneIndexes: [0, 1],
      closedTabs: [
        { kind: "logs", target: { name: "api", namespace: "prod" }, pinned: true },
        { kind: "yaml", target: null, pinned: false },
        { kind: "events", target: { name: "x", namespace: "y" }, pinned: false },
      ],
      workbenchCollapsed: true,
      workbenchFullscreen: false,
    });
  });

  it("treats string booleans safely for legacy payloads", () => {
    const parsed = parseDeploymentsWorkbenchState(
      JSON.stringify({
        version: 1,
        tabs: [{ kind: "yaml", name: "api", namespace: "prod", pinned: false }],
        layout: "single",
        paneTabIds: [],
        collapsedPaneIndexes: [],
        closedTabs: [],
        workbenchCollapsed: "false",
        workbenchFullscreen: "true",
      }),
    );

    expect(parsed?.workbenchCollapsed).toBe(false);
    expect(parsed?.workbenchFullscreen).toBe(true);
  });
});
