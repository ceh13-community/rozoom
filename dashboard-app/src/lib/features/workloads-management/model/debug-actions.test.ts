import { describe, expect, it } from "vitest";
import { buildDebugActions } from "./debug-actions";

describe("debug-actions", () => {
  it("builds get/describe/logs commands", () => {
    const actions = buildDebugActions({
      resource: "pods",
      name: "api-123",
      namespace: "prod",
      logsTarget: "api-123",
    });
    expect(actions.getYaml).toBe("kubectl get pods api-123 -n prod -o yaml");
    expect(actions.describe).toBe("kubectl describe pods api-123 -n prod");
    expect(actions.logs).toContain("logs api-123");
  });
});
