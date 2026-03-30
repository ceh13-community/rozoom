import { describe, expect, it } from "vitest";
import { evaluateCrdInstanceHealth } from "./crd-instance-health";

describe("crd-instance-health", () => {
  it("detects healthy instance with Ready=True", () => {
    const result = evaluateCrdInstanceHealth(
      [
        {
          metadata: { name: "cert-1", namespace: "default" },
          status: { conditions: [{ type: "Ready", status: "True", reason: "" }] },
        },
      ],
      "Certificate",
    );
    expect(result.healthyCount).toBe(1);
    expect(result.healthPercent).toBe(100);
  });

  it("detects unhealthy instance", () => {
    const result = evaluateCrdInstanceHealth(
      [
        {
          metadata: { name: "cert-2" },
          status: { conditions: [{ type: "Ready", status: "False", reason: "NotReady" }] },
        },
      ],
      "Certificate",
    );
    expect(result.unhealthyCount).toBe(1);
  });

  it("treats no conditions as healthy", () => {
    const result = evaluateCrdInstanceHealth([{ metadata: { name: "x" }, status: {} }], "Custom");
    expect(result.healthyCount).toBe(1);
  });
});
