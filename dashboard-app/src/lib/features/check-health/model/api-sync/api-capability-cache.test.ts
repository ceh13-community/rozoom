import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getApiPathCapability,
  markApiPathCapability,
  markApiPathCapabilityFromError,
  resetApiCapabilityCache,
  shouldSkipApiPath,
} from "./api-capability-cache";

describe("api-capability-cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetApiCapabilityCache();
  });

  it("marks unsupported and forbidden paths as skippable", () => {
    markApiPathCapability("cluster-a", "/apis/gateway/v1/gateways", {
      status: "unsupported",
      reason: "the server could not find the requested resource",
    });
    markApiPathCapability("cluster-a", "/api/v1/secrets", {
      status: "forbidden",
      reason: "forbidden",
    });

    expect(shouldSkipApiPath("cluster-a", "/apis/gateway/v1/gateways")).toBe(true);
    expect(shouldSkipApiPath("cluster-a", "/api/v1/secrets")).toBe(true);
  });

  it("does not skip unreachable paths so they can recover", () => {
    markApiPathCapability("cluster-a", "/api/v1/pods", {
      status: "unreachable",
      reason: "no route to host",
    });

    expect(shouldSkipApiPath("cluster-a", "/api/v1/pods")).toBe(false);
  });

  it("normalizes error reasons when marking from error", () => {
    markApiPathCapabilityFromError(
      "cluster-a",
      "/apis/autoscaling.k8s.io/v1/verticalpodautoscalers",
      new Error("the server could not find the requested resource"),
    );

    expect(
      getApiPathCapability("cluster-a", "/apis/autoscaling.k8s.io/v1/verticalpodautoscalers"),
    ).toMatchObject({
      status: "unsupported",
    });
  });
});
