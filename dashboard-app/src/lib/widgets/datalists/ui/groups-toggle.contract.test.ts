import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(__dirname, file), "utf8");

// A "Collapse groups" button that existed in the toolbar only in grouped views made the
// toolbar wrap at normal widths: choosing a grouping moved the filter and the table down.
// The toggle now sits in the grouped table itself, so the toolbar is the same in every view.
describe("collapse/expand groups toggle", () => {
  it.each([
    ["pods-list/data-table.svelte", "getToggleAllGroupsLabel()"],
    ["configuration-list.svelte", "getGroupCollapseToggleLabel(collapsedGroups, groupKeys)"],
    ...[
      "deployments-list",
      "daemon-sets-list",
      "stateful-sets-list",
      "replica-sets-list",
      "jobs-list",
      "cron-jobs-list",
    ].map((list) => [`${list}/data-table.svelte`, "getGroupCollapseToggleLabel("]),
  ])("%s keeps the toggle out of the toolbar", (file, label) => {
    const source = read(file);
    const toolbar = source.slice(
      source.indexOf("<TableToolbarShell"),
      source.indexOf("</TableToolbarShell>"),
    );
    expect(toolbar.length).toBeGreaterThan(0);
    expect(toolbar).not.toContain("toggleAllGroups");
    expect(source).toContain('data-testid="groups-toggle"');
    expect(source).toContain(label);
    // Keyboard users see where focus is on the plain text button.
    const testId = source.indexOf('data-testid="groups-toggle"');
    const buttonTag = source.slice(source.lastIndexOf("<button", testId), testId);
    expect(buttonTag).toContain("focus-visible:ring-2");
  });
});
