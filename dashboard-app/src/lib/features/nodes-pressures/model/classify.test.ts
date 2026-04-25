import { describe, expect, it } from "vitest";
import {
  classifyNodeSeverity,
  SEVERITY_BADGE_CLASS,
  SEVERITY_LABEL,
  SEVERITY_RANK,
} from "./classify";

function baseInput() {
  return {
    ready: "True",
    diskPressure: "False",
    memoryPressure: "False",
    pidPressure: "False",
    networkUnavailable: "False",
    unschedulable: false,
  };
}

describe("classifyNodeSeverity", () => {
  it("returns healthy when all conditions are good", () => {
    expect(classifyNodeSeverity(baseInput())).toBe("healthy");
  });

  it("returns critical when Ready != True", () => {
    expect(classifyNodeSeverity({ ...baseInput(), ready: "False" })).toBe("critical");
    expect(classifyNodeSeverity({ ...baseInput(), ready: "Unknown" })).toBe("critical");
  });

  it("returns critical when NetworkUnavailable=True even with Ready=True", () => {
    expect(classifyNodeSeverity({ ...baseInput(), networkUnavailable: "True" })).toBe("critical");
  });

  it("returns critical when two pressures are True", () => {
    expect(
      classifyNodeSeverity({
        ...baseInput(),
        diskPressure: "True",
        memoryPressure: "True",
      }),
    ).toBe("critical");
  });

  it("returns warning when exactly one pressure is True", () => {
    expect(classifyNodeSeverity({ ...baseInput(), memoryPressure: "True" })).toBe("warning");
    expect(classifyNodeSeverity({ ...baseInput(), diskPressure: "True" })).toBe("warning");
    expect(classifyNodeSeverity({ ...baseInput(), pidPressure: "True" })).toBe("warning");
  });

  it("returns cordoned when unschedulable=true and no pressures", () => {
    expect(classifyNodeSeverity({ ...baseInput(), unschedulable: true })).toBe("cordoned");
  });

  it("prefers warning over cordoned when a pressure is also present", () => {
    expect(
      classifyNodeSeverity({
        ...baseInput(),
        unschedulable: true,
        memoryPressure: "True",
      }),
    ).toBe("warning");
  });

  it("prefers critical over cordoned when Ready=False", () => {
    expect(
      classifyNodeSeverity({
        ...baseInput(),
        unschedulable: true,
        ready: "False",
      }),
    ).toBe("critical");
  });

  it("SEVERITY_RANK orders critical > warning > cordoned > healthy", () => {
    expect(SEVERITY_RANK.critical).toBeGreaterThan(SEVERITY_RANK.warning);
    expect(SEVERITY_RANK.warning).toBeGreaterThan(SEVERITY_RANK.cordoned);
    expect(SEVERITY_RANK.cordoned).toBeGreaterThan(SEVERITY_RANK.healthy);
  });

  it("SEVERITY_BADGE_CLASS has entry for every severity", () => {
    (["healthy", "warning", "critical", "cordoned"] as const).forEach((s) => {
      expect(SEVERITY_BADGE_CLASS[s]).toMatch(/^bg-/);
      expect(SEVERITY_LABEL[s]).toBeTruthy();
    });
  });
});
