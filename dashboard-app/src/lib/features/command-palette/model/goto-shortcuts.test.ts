import { describe, expect, it } from "vitest";
import { getGotoChords, GOTO_CHORD_MAP } from "./goto-shortcuts";

describe("GOTO_CHORD_MAP", () => {
  it("maps d to deployments", () => {
    expect(GOTO_CHORD_MAP.d).toBe("deployments");
  });

  it("maps p to pods", () => {
    expect(GOTO_CHORD_MAP.p).toBe("pods");
  });

  it("maps n to nodesstatus", () => {
    expect(GOTO_CHORD_MAP.n).toBe("nodesstatus");
  });
});

describe("getGotoChords", () => {
  it("returns chord entries for all mappings", () => {
    const chords = getGotoChords();
    expect(chords.length).toBe(Object.keys(GOTO_CHORD_MAP).length);
  });

  it("formats chord as 'g <key>'", () => {
    const chords = getGotoChords();
    const deployments = chords.find((c) => c.workload === "deployments");
    expect(deployments?.chord).toBe("g d");
  });

  it("provides human-readable label", () => {
    const chords = getGotoChords();
    const pods = chords.find((c) => c.workload === "pods");
    expect(pods?.label).toBe("Pods");
  });
});
