import { describe, expect, it } from "vitest";
import { parseNodeTopOutput } from "./node-top";

describe("node-top helpers", () => {
  it("parses kubectl top node output", () => {
    expect(
      parseNodeTopOutput(
        `NAME CPU(cores) CPU% MEMORY(bytes) MEMORY%\nworker-1 250m 12% 1024Mi 34%\n`,
      ),
    ).toEqual({
      cpu: "250m",
      cpuPercent: "12%",
      memory: "1024Mi",
      memoryPercent: "34%",
    });
  });
});
