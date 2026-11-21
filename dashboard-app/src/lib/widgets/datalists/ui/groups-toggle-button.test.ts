import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import GroupsToggleButton from "./groups-toggle-button.svelte";

const read = (file: string) => readFileSync(resolve("src/lib/widgets/datalists/ui", file), "utf8");

// Choosing a grouped view added this button to the toolbar, which then wrapped and moved
// everything below it down. It is now always in the layout and only hidden.
describe("groups toggle button", () => {
  it("stays in the layout but hidden, inert and unfocusable in the flat view", () => {
    const onclick = vi.fn();
    render(GroupsToggleButton, { visible: false, label: "Collapse groups", onclick });
    const button = screen.getByTestId("groups-toggle");
    expect(button.getAttribute("aria-hidden")).toBe("true");
    expect(button.getAttribute("tabindex")).toBe("-1");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("works in a grouped view and keeps one width for both labels", async () => {
    const onclick = vi.fn();
    render(GroupsToggleButton, { visible: true, label: "Expand groups", onclick });
    const button = screen.getByTestId("groups-toggle");
    expect(button.getAttribute("aria-hidden")).toBeNull();
    await fireEvent.click(button);
    expect(onclick).toHaveBeenCalledOnce();
  });

  // The test DOM drops Button's class attribute, so the layout classes are checked in source.
  it("hides with visibility (keeps its box) and has one width for both labels", () => {
    const source = read("groups-toggle-button.svelte");
    expect(source).toContain('${visible ? "" : "invisible"}');
    expect(source).toContain("min-w-[8.5rem]");
    expect(source).not.toMatch(/\{#if visible\}/);
  });

  it.each(["pods-list/data-table.svelte", "configuration-list.svelte"])(
    "%s renders the toggle unconditionally",
    (file) => {
      const source = read(file);
      expect(source).toContain("<GroupsToggleButton");
      expect(source).not.toMatch(/\{#if [^}]*\}\s*<GroupsToggleButton/);
      expect(source).not.toMatch(
        /\{#if [^}]*[Gg]roup[^}]*\}\s*<Button[^>]*onclick=\{toggleAllGroups\}/,
      );
    },
  );
});
