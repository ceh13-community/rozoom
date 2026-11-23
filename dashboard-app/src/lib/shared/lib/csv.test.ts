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

  it("does not let an emoji hide a formula", () => {
    expect(csvCell("🏃=1+1")).toBe('"\'=1+1"');
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
});
