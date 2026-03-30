import { describe, expect, it } from "vitest";
import { containerLabelToState, podPhaseToState } from "./status-state";

describe("podPhaseToState", () => {
  it("maps running and succeeded to ready", () => {
    expect(podPhaseToState("Running")).toBe("ready");
    expect(podPhaseToState("Succeeded")).toBe("ready");
  });

  it("maps pending to progressing", () => {
    expect(podPhaseToState("Pending")).toBe("progressing");
  });

  it("maps failed to error", () => {
    expect(podPhaseToState("Failed")).toBe("error");
  });
});

describe("containerLabelToState", () => {
  it("maps running and ready labels to ready", () => {
    expect(containerLabelToState("running, ready")).toBe("ready");
  });

  it("maps waiting labels to progressing", () => {
    expect(containerLabelToState("waiting (ContainerCreating)")).toBe("progressing");
  });

  it("maps terminated labels to error", () => {
    expect(containerLabelToState("terminated (Error)")).toBe("error");
  });
});
