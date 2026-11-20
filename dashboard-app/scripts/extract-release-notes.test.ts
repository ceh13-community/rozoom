import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const script = path.resolve(__dirname, "extract-release-notes.sh");

function extract(changelog: string, version = "9.9.9"): string {
  const dir = mkdtempSync(path.join(tmpdir(), "release-notes-"));
  const file = path.join(dir, "CHANGELOG.md");
  writeFileSync(file, changelog);
  return execFileSync("bash", [script, version, file], { encoding: "utf8" });
}

// CHANGELOG.md is wrapped at 80 columns. GitHub release bodies (and the latest.json notes
// copied from them) render every newline as a line break, so the notes showed as a narrow
// column of broken lines.
describe("extract-release-notes.sh", () => {
  const changelog = [
    "# Changelog",
    "",
    "## [9.9.9] - 2026-11-20",
    "",
    "Security release. Inspect Element in the right-click menu",
    "opened the web inspector. Release builds no longer contain it.",
    "",
    "### Fixed",
    "",
    "- The details panel closes with",
    "  Escape.",
    "- Popovers stay inside the window",
    "  and scroll.",
    "  - A nested item that is",
    "    wrapped too.",
    "1. A numbered item",
    "   that wraps.",
    "",
    "| Column | Value |",
    "|---|---|",
    "| a | b |",
    "",
    "```",
    "kubectl get pods",
    "  --all-namespaces",
    "```",
    "",
    "> A quote that",
    "> wraps.",
    "",
    "## [9.9.8] - 2026-11-01",
    "",
    "Older release.",
    "",
  ].join("\n");

  it("joins the lines of a paragraph and of a list item", () => {
    const notes = extract(changelog).split("\n");
    expect(notes[0]).toBe(
      "Security release. Inspect Element in the right-click menu opened the web inspector. Release builds no longer contain it.",
    );
    expect(notes).toContain("- The details panel closes with Escape.");
    expect(notes).toContain("- Popovers stay inside the window and scroll.");
    expect(notes).toContain("  - A nested item that is wrapped too.");
    expect(notes).toContain("1. A numbered item that wraps.");
  });

  it("keeps headings, tables, code blocks and quotes line by line", () => {
    const notes = extract(changelog);
    expect(notes).toContain("\n### Fixed\n");
    expect(notes).toContain("| Column | Value |\n|---|---|\n| a | b |\n");
    expect(notes).toContain("```\nkubectl get pods\n  --all-namespaces\n```\n");
    expect(notes).toContain("> A quote that\n> wraps.\n");
  });

  it("keeps paragraph breaks and stops at the next version", () => {
    const notes = extract(changelog);
    expect(notes).toContain("contain it.\n\n### Fixed\n\n- The details");
    expect(notes).not.toContain("Older release.");
    expect(notes.endsWith("> wraps.\n")).toBe(true);
  });

  it("still fails when the version has no section", () => {
    expect(() => extract(changelog, "1.0.0")).toThrow();
  });
});
