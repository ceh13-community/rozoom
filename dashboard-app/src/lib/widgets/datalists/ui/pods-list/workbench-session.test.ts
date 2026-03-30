import { describe, expect, it } from "vitest";
import {
  getLegacyPodsWorkbenchStateKey,
  getPodsWorkbenchStateKey,
  parsePodsWorkbenchState,
} from "./workbench-session";

describe("pods workbench session", () => {
  it("builds stable localStorage keys", () => {
    expect(getLegacyPodsWorkbenchStateKey("cluster-a")).toBe(
      "dashboard.pods.workbench.state.v1:cluster-a",
    );
    expect(getPodsWorkbenchStateKey("cluster-a", "balanced")).toBe(
      "dashboard.pods.workbench.state.v1:cluster-a:balanced",
    );
  });

  it("returns null for invalid payload", () => {
    expect(parsePodsWorkbenchState(null)).toBeNull();
    expect(parsePodsWorkbenchState("bad-json")).toBeNull();
    expect(parsePodsWorkbenchState(JSON.stringify({ version: 2 }))).toBeNull();
  });

  it("normalizes and keeps valid state", () => {
    const parsed = parsePodsWorkbenchState(
      JSON.stringify({
        version: 1,
        tabs: [
          { kind: "logs", name: "api", namespace: "prod", pinned: true },
          { kind: "events", name: "api", namespace: "prod", pinned: false },
          { kind: "unknown", name: "x", namespace: "y", pinned: true },
        ],
        activeTabId: "logs:prod/api",
        layout: "triple",
        paneTabIds: ["logs:prod/api", "events:prod/api", {}],
        collapsedPaneIndexes: [0, 2, -1],
        closedTabs: [
          { kind: "yaml", target: { name: "api", namespace: "prod" }, pinned: true },
          { kind: "bad", target: null, pinned: false },
        ],
        workbenchCollapsed: 0,
        workbenchFullscreen: 1,
      }),
    );

    expect(parsed).toEqual({
      version: 1,
      tabs: [
        { kind: "logs", name: "api", namespace: "prod", pinned: true },
        { kind: "events", name: "api", namespace: "prod", pinned: false },
      ],
      activeTabId: "logs:prod/api",
      layout: "triple",
      paneTabIds: ["logs:prod/api", "events:prod/api", null],
      collapsedPaneIndexes: [0, 2],
      closedTabs: [{ kind: "yaml", target: { name: "api", namespace: "prod" }, pinned: true }],
      workbenchCollapsed: false,
      workbenchFullscreen: true,
    });
  });

  it("treats string booleans safely for legacy payloads", () => {
    const parsed = parsePodsWorkbenchState(
      JSON.stringify({
        version: 1,
        tabs: [{ kind: "logs", name: "api", namespace: "prod", pinned: false }],
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
