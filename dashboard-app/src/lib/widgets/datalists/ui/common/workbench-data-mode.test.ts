import { describe, expect, it } from "vitest";
import {
  buildDataModeWorkbenchStorageKey,
  isRealtimeWorkbenchProfile,
  normalizeWorkbenchVisibilityForDataMode,
} from "./workbench-data-mode";

describe("workbench-data-mode", () => {
  it("uses profile-scoped storage keys", () => {
    expect(
      buildDataModeWorkbenchStorageKey("dashboard.workbench.state.v1:cluster-a", "balanced"),
    ).toBe("dashboard.workbench.state.v1:cluster-a:balanced");
  });

  it("forces expanded visibility in realtime", () => {
    expect(isRealtimeWorkbenchProfile("realtime")).toBe(true);
    expect(
      normalizeWorkbenchVisibilityForDataMode("realtime", {
        workbenchCollapsed: true,
        collapsedPaneIndexes: [0, 2],
      }),
    ).toEqual({
      workbenchCollapsed: false,
      collapsedPaneIndexes: [],
    });
  });

  it("preserves visibility in non-realtime modes", () => {
    expect(
      normalizeWorkbenchVisibilityForDataMode("balanced", {
        workbenchCollapsed: true,
        collapsedPaneIndexes: [1],
      }),
    ).toEqual({
      workbenchCollapsed: true,
      collapsedPaneIndexes: [1],
    });
  });
});
