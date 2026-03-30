import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  getFeatureCapability,
  markFeatureCapability,
  markFeatureCapabilityFromReason,
  resetFeatureCapabilityCache,
  shouldSkipFeatureProbe,
} from "./feature-capability-cache";

describe("feature-capability-cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetFeatureCapabilityCache();
  });

  it("stores and expires feature capabilities", () => {
    markFeatureCapability("cluster-a", "resource:vpa", { status: "available" });
    expect(getFeatureCapability("cluster-a", "resource:vpa")).toEqual(
      expect.objectContaining({ status: "available" }),
    );

    vi.advanceTimersByTime(5 * 60_000 + 1);
    expect(getFeatureCapability("cluster-a", "resource:vpa")).toBeNull();
  });

  it("classifies unsupported and forbidden reasons for skip decisions", () => {
    markFeatureCapabilityFromReason(
      "cluster-a",
      "resource:vpa",
      'error: the server doesn\'t have a resource type "verticalpodautoscalers"',
    );
    expect(shouldSkipFeatureProbe("cluster-a", "resource:vpa")).toBe(true);

    markFeatureCapabilityFromReason(
      "cluster-a",
      "resource:foo",
      "Forbidden: user cannot list this resource",
    );
    expect(shouldSkipFeatureProbe("cluster-a", "resource:foo")).toBe(true);
  });

  it("classifies failed connect errors as unreachable", () => {
    markFeatureCapabilityFromReason(
      "cluster-a",
      "resource:pods",
      "Failed to connect to cluster endpoint",
    );

    expect(getFeatureCapability("cluster-a", "resource:pods")).toEqual(
      expect.objectContaining({ status: "unreachable" }),
    );
  });
});
