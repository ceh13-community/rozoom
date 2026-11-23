import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { csvCell, csvRow, csvText } from "./csv";

describe("csv", () => {
  it("quotes every cell, doubles quotes and leaves null and undefined empty", () => {
    expect(csvCell("web")).toBe('"web"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(3)).toBe('"3"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });

  it("saves the plain status without the list emoji, keeps emoji inside the text", () => {
    expect(csvCell("🏃Running")).toBe('"Running"');
    expect(csvCell("🕰️Pending")).toBe('"Pending"');
    expect(csvCell("⚠️Critical")).toBe('"Critical"');
    expect(csvCell("💪Ready")).toBe('"Ready"');
    expect(csvCell("a 🔥 b")).toBe('"a 🔥 b"');
  });

  it("opens a would-be formula as text", () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
    expect(csvCell("+cmd|' /C calc'!A0")).toBe("\"'+cmd|' /C calc'!A0\"");
    expect(csvCell("-1+1")).toBe('"\'-1+1"');
    expect(csvCell("@SUM(A1)")).toBe('"\'@SUM(A1)"');
    expect(csvCell("\t=1")).toBe('"\'\t=1"');
    expect(csvCell("\r=1")).toBe('"\'\r=1"');
  });

  it("drops only the status emoji the lists glue to a word", () => {
    for (const [shown, saved] of [
      ["🏃Running", "Running"],
      ["🕰️Pending", "Pending"],
      ["😔Failed", "Failed"],
      ["⚠️Critical", "Critical"],
      ["🔃Restarted", "Restarted"],
      ["💪Succeed", "Succeed"],
      ["❌Terminated", "Terminated"],
      ["📉Degraded", "Degraded"],
      ["🐌Progressing", "Progressing"],
      ["🍏Available", "Available"],
    ]) {
      expect(csvCell(shown)).toBe(`"${saved}"`);
    }
  });

  it("keeps other symbols at the start of a cell", () => {
    expect(csvCell("©2024 Corp")).toBe('"©2024 Corp"');
    expect(csvCell("™Brand")).toBe('"™Brand"');
    expect(csvCell("↔ both ways")).toBe('"↔ both ways"');
    expect(csvCell("🔥hot")).toBe('"🔥hot"');
    expect(csvCell("🏃 running late")).toBe('"🏃 running late"');
  });

  it("an emoji before a formula is not stripped, so the cell stays text", () => {
    expect(csvCell("🏃=1+1")).toBe('"🏃=1+1"');
  });

  it("keeps plain numbers and the - placeholder as they are", () => {
    expect(csvCell("-5")).toBe('"-5"');
    expect(csvCell("+3.5")).toBe('"+3.5"');
    expect(csvCell("-")).toBe('"-"');
    expect(csvCell("10m")).toBe('"10m"');
  });

  it("joins cells into rows and rows into a text", () => {
    expect(csvRow(["a", null, "🏃Running"])).toBe('"a",,"Running"');
    expect(csvText([["Name"], ["web"]])).toBe('"Name"\n"web"');
  });

  it("knows every status emoji the app glues to a word", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return files(path);
        return /\.(svelte|ts)$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
      });
    const glued = /"((?:\p{Extended_Pictographic}|\u{FE0F})+)(\p{Lu}[A-Za-z]*)"/gu;
    const found = new Map<string, string>();
    for (const file of files(resolve(__dirname, "../../.."))) {
      for (const m of readFileSync(file, "utf8").matchAll(glued))
        found.set(m[0].slice(1, -1), m[2]);
    }
    expect(found.size).toBeGreaterThan(5);
    for (const [shown, word] of found) expect(csvCell(shown), shown).toBe(`"${word}"`);
  });
});
