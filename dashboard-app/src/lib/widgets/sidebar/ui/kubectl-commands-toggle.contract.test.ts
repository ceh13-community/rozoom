import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The switch for kubectl command toasts sits in the rail next to Linter and Runtime and must
// look like them: the same off colours, a short label on one line ("Commands on" / "off"),
// left-aligned. The full name stays in the aria-label and the hint; the state reads in words,
// and on the collapsed rail as a dot, not by colour alone (WCAG 1.4.1).
const source = readFileSync(resolve(__dirname, "sidebar.svelte"), "utf8");

function buttonFor(handler: string): string {
  const click = source.indexOf(`onclick={${handler}}`);
  return source.slice(source.lastIndexOf("<button", click), source.indexOf("</button>", click));
}

function offClasses(button: string): string | undefined {
  return /\?\s*cn\(NAV_ACTIVE_CLASS, NAV_ACTIVE_HOVER_CLASS\)\s*:\s*"([^"]+)"/.exec(button)?.[1];
}

const toggle = buttonFor("toggleCliNotifications");

describe("kubectl commands switch", () => {
  it("is named Show kubectl commands, with the terminal icon in both states", () => {
    expect(toggle).toContain('aria-label="Show kubectl commands"');
    expect(toggle).toContain("aria-pressed={cliNotificationsEnabled}");
    expect(toggle).toContain('<Terminal class="h-4 w-4" />');
    expect(toggle).not.toContain("MessageSquare");
  });

  it("says on or off in a short label on one line, the full name in the hint", () => {
    expect(toggle).toContain('Commands {cliNotificationsEnabled ? "on" : "off"}');
    expect(toggle).toContain('"whitespace-nowrap text-left"');
    expect(toggle).toContain(
      'use:hint={`Show kubectl commands: ${cliNotificationsEnabled ? "on" : "off"}`}',
    );
  });

  it("marks on with a dot on the icon when the rail is collapsed", () => {
    expect(toggle).toContain("{#if cliNotificationsEnabled && !sidebarOpen}");
    expect(toggle).toContain('data-testid="kubectl-commands-on-dot"');
  });

  it("highlights on, and is off in the same colours as Linter and Runtime", () => {
    const linterOff = offClasses(buttonFor("toggleLinter"));
    const runtimeOff = offClasses(buttonFor("toggleDiagnostics"));
    expect(linterOff).toBeDefined();
    expect(runtimeOff).toBe(linterOff);
    expect(offClasses(toggle)).toBe(linterOff);
  });
});
