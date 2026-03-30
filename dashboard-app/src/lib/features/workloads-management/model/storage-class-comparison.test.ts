import { describe, expect, it } from "vitest";
import { compareStorageClasses } from "./storage-class-comparison";

describe("storage-class-comparison", () => {
  it("detects identical classes", () => {
    const sc = {
      metadata: { name: "fast" },
      provisioner: "ebs.csi.aws.com",
      reclaimPolicy: "Delete",
      volumeBindingMode: "WaitForFirstConsumer",
    };
    expect(compareStorageClasses(sc, sc).identical).toBe(true);
  });

  it("detects parameter differences", () => {
    const left = { metadata: { name: "a" }, provisioner: "ebs", parameters: { type: "gp2" } };
    const right = { metadata: { name: "b" }, provisioner: "ebs", parameters: { type: "gp3" } };
    const result = compareStorageClasses(left, right);
    expect(result.differenceCount).toBeGreaterThan(0);
    expect(result.fields.find((f) => f.label === "param: type")?.differs).toBe(true);
  });
});
