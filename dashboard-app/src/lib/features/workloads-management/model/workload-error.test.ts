import { describe, expect, it } from "vitest";
import { toWorkloadError } from "./workload-error";

describe("workload-error", () => {
  it("maps common error patterns", () => {
    expect(toWorkloadError(new Error("forbidden by RBAC")).code).toBe("ACCESS_DENIED");
    expect(toWorkloadError(new Error("resource not found")).code).toBe("RESOURCE_NOT_FOUND");
    expect(toWorkloadError(new Error("kubectl not available")).code).toBe("KUBECTL_UNAVAILABLE");
  });
});
