import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The switch for kubectl command toasts read as disabled when off (grey text, a struck
// message icon) and was named "CLI toasts". One name and the terminal icon for both
// states; the state reads in words, and on the collapsed rail as a dot, not by colour
// alone (WCAG 1.4.1). Off is the plain rail colour, on is highlighted.
const source = readFileSync(resolve(__dirname, "sidebar.svelte"), "utf8");
const click = source.indexOf("onclick={toggleCliNotifications}");
const toggle = source.slice(
  source.lastIndexOf("<button", click),
  source.indexOf("</button>", click),
);

describe("kubectl commands switch", () => {
  it("is named Show kubectl commands, with the terminal icon in both states", () => {
    expect(toggle).toContain('aria-label="Show kubectl commands"');
    expect(toggle).toContain("aria-pressed={cliNotificationsEnabled}");
    expect(toggle).toContain('<Terminal class="h-4 w-4" />');
    expect(toggle).not.toContain("MessageSquare");
  });

  it("says on or off in words, in the label and the hint", () => {
    expect(toggle).toContain('Show kubectl commands {cliNotificationsEnabled ? "on" : "off"}');
    expect(toggle).toContain(
      'use:hint={`Show kubectl commands: ${cliNotificationsEnabled ? "on" : "off"}`}',
    );
  });

  it("marks on with a dot on the icon when the rail is collapsed", () => {
    expect(toggle).toContain("{#if cliNotificationsEnabled && !sidebarOpen}");
    expect(toggle).toContain('data-testid="kubectl-commands-on-dot"');
  });

  it("highlights on, and keeps off in the plain rail colour", () => {
    expect(toggle).toContain("cn(NAV_ACTIVE_CLASS, NAV_ACTIVE_HOVER_CLASS)");
    expect(toggle).not.toMatch(/text-slate-400|opacity-50|bg-slate-600\/20/);
  });
});
