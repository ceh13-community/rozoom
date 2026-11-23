import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_PRINCIPLES, PHILOSOPHY_URL, TEAM_MEMBERS } from "./team";

const philosophy = readFileSync(resolve("PHILOSOPHY.md"), "utf8");
const corePrinciples = philosophy.split("## Core principles")[1]?.split(/\n## /)[0] ?? "";

describe("About the team data", () => {
  it("names four contributors; the humans have a GitHub and a LinkedIn profile, Claude has none", () => {
    expect(TEAM_MEMBERS.map((m) => m.name)).toEqual([
      "Stanislav Ponomaryov",
      "Yurii Pozhar",
      "Kostiantyn Nesterenko",
      "Claude (Anthropic)",
    ]);
    for (const member of TEAM_MEMBERS) {
      if (member.name === "Claude (Anthropic)") {
        expect(member.github).toBeUndefined();
        expect(member.linkedin).toBeUndefined();
      } else {
        expect(member.github).toMatch(/^https:\/\/github\.com\/[A-Za-z0-9-]+$/);
        expect(member.linkedin).toMatch(/^https:\/\/www\.linkedin\.com\/in\/[A-Za-z0-9-]+\/$/);
      }
    }
  });

  it("follows the seven Core principles of PHILOSOPHY.md in their order", () => {
    const headings = [...corePrinciples.matchAll(/^### \d\. (.+)$/gm)].map((m) => m[1].trim());
    expect(headings).toEqual(CORE_PRINCIPLES.map((p) => p.title));
    expect(PHILOSOPHY_URL).toBe(
      "https://github.com/ceh13-community/rozoom/blob/main/dashboard-app/PHILOSOPHY.md",
    );
  });

  it("keeps every line short and plain: one sentence, keyboard characters only", () => {
    for (const principle of CORE_PRINCIPLES) {
      expect(principle.line.split(" ").length).toBeLessThanOrEqual(26);
      expect(principle.line).not.toMatch(/[—–•«»“”‘’…→]/);
    }
  });
});
