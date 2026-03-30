import { describe, expect, it } from "vitest";
import { recoverWorkbenchTabs } from "./workbench-tab-recovery";

describe("workbench tab recovery", () => {
  it("returns null when header tabs already exist", () => {
    const result = recoverWorkbenchTabs({
      currentTabs: [{ id: "logs:ns/a", kind: "logs", title: "Logs a", subtitle: "ns" }],
      candidates: [{ id: "yaml:ns/a", kind: "yaml", title: "YAML a", subtitle: "ns" }],
      activeTabId: null,
    });
    expect(result).toBeNull();
  });

  it("rebuilds tabs and keeps active tab when possible", () => {
    const result = recoverWorkbenchTabs({
      currentTabs: [],
      candidates: [
        { id: "logs:ns/a", kind: "logs", title: "Logs a", subtitle: "ns" },
        { id: "yaml:ns/a", kind: "yaml", title: "YAML a", subtitle: "ns" },
      ],
      activeTabId: "yaml:ns/a",
    });
    expect(result).toEqual({
      tabs: [
        { id: "logs:ns/a", kind: "logs", title: "Logs a", subtitle: "ns" },
        { id: "yaml:ns/a", kind: "yaml", title: "YAML a", subtitle: "ns" },
      ],
      activeTabId: "yaml:ns/a",
    });
  });

  it("deduplicates by id and falls back to first tab when active is missing", () => {
    const result = recoverWorkbenchTabs({
      currentTabs: [],
      candidates: [
        { id: "logs:ns/a", kind: "logs", title: "Logs a", subtitle: "ns" },
        { id: "logs:ns/a", kind: "logs", title: "Logs a duplicate", subtitle: "ns" },
      ],
      activeTabId: "yaml:ns/a",
    });
    expect(result).toEqual({
      tabs: [{ id: "logs:ns/a", kind: "logs", title: "Logs a", subtitle: "ns" }],
      activeTabId: "logs:ns/a",
    });
  });
});
