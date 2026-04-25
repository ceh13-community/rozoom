import { describe, expect, it } from "vitest";
import { humanizeNodeCondition, TAINT_EFFECTS } from "./humanize";

describe("humanizeNodeCondition", () => {
  it("flags MemoryPressure with eviction hint", () => {
    const result = humanizeNodeCondition("MemoryPressure", "True");
    expect(result.category).toBe("memory");
    expect(result.title).toMatch(/memory pressure/i);
    expect(result.hint).toContain("eviction");
  });

  it("flags DiskPressure with cleanup hint", () => {
    const result = humanizeNodeCondition("DiskPressure", "True");
    expect(result.category).toBe("disk");
    expect(result.hint).toContain("image");
  });

  it("flags PIDPressure with process-find hint", () => {
    const result = humanizeNodeCondition("PIDPressure", "True");
    expect(result.category).toBe("pid");
    expect(result.hint).toContain("ps");
  });

  it("flags NetworkUnavailable with CNI hint", () => {
    const result = humanizeNodeCondition("NetworkUnavailable", "True");
    expect(result.category).toBe("network");
    expect(result.hint).toMatch(/CNI/);
  });

  it("does not flag pressure conditions when status is False", () => {
    const result = humanizeNodeCondition("MemoryPressure", "False");
    expect(result.category).toBe("unknown");
  });

  it("routes Ready=Unknown with kubelet reason to kubelet hint", () => {
    const result = humanizeNodeCondition(
      "Ready",
      "Unknown",
      "KubeletNotReady",
      "kubelet has not posted status",
    );
    expect(result.category).toBe("ready");
    expect(result.hint).toContain("kubelet");
  });

  it("routes Ready=Unknown with PLEG message to runtime hint", () => {
    const result = humanizeNodeCondition("Ready", "Unknown", undefined, "PLEG is not healthy");
    expect(result.category).toBe("ready");
    expect(result.title).toMatch(/runtime|pleg/i);
  });

  it("gives generic NotReady hint when no reason/message", () => {
    const result = humanizeNodeCondition("Ready", "False");
    expect(result.category).toBe("ready");
    expect(result.title).toContain("NotReady");
  });

  it("handles unknown condition type with reason/message", () => {
    const result = humanizeNodeCondition(
      "WeirdCondition",
      "True",
      "SomethingHappened",
      "details here",
    );
    expect(result.category).toBe("unknown");
    expect(result.hint).toContain("SomethingHappened");
  });

  it("TAINT_EFFECTS map has hints for all three effects", () => {
    expect(TAINT_EFFECTS.NoSchedule.hint).toMatch(/schedule/i);
    expect(TAINT_EFFECTS.NoExecute.hint).toMatch(/evict/i);
    expect(TAINT_EFFECTS.PreferNoSchedule.hint).toMatch(/avoid/i);
  });
});
