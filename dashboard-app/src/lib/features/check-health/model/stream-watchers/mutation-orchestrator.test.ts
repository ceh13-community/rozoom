import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeMutationAck,
  beginMutationAck,
  cancelMutationAcksForScope,
} from "./mutation-orchestrator";

describe("mutation-orchestrator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cancelMutationAcksForScope("cluster-a", "deployment");
  });

  afterEach(() => {
    cancelMutationAcksForScope("cluster-a", "deployment");
    cancelMutationAcksForScope("cluster-a", "configuration:namespace");
    vi.useRealTimers();
  });

  it("does not run fallback when matching watch event acknowledges the mutation", () => {
    const onTimeout = vi.fn();

    beginMutationAck({
      clusterId: "cluster-a",
      scopeKey: "deployment",
      ids: ["default/app"],
      expectedEventTypes: ["DELETED"],
      timeoutMs: 1000,
      onTimeout,
    });

    acknowledgeMutationAck("cluster-a", "deployment", "default/app", "DELETED");
    vi.advanceTimersByTime(1000);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("runs fallback when no matching watch event arrives before timeout", () => {
    const onTimeout = vi.fn();

    beginMutationAck({
      clusterId: "cluster-a",
      scopeKey: "deployment",
      ids: ["default/app"],
      expectedEventTypes: ["MODIFIED"],
      timeoutMs: 1000,
      onTimeout,
    });

    vi.advanceTimersByTime(1000);

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("waits for all tracked ids before clearing the mutation", () => {
    const onTimeout = vi.fn();

    beginMutationAck({
      clusterId: "cluster-a",
      scopeKey: "deployment",
      ids: ["default/app-a", "default/app-b"],
      expectedEventTypes: ["DELETED"],
      timeoutMs: 1000,
      onTimeout,
    });

    acknowledgeMutationAck("cluster-a", "deployment", "default/app-a", "DELETED");
    vi.advanceTimersByTime(1000);

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("does not run fallback after the scope is cancelled", () => {
    const onTimeout = vi.fn();

    beginMutationAck({
      clusterId: "cluster-a",
      scopeKey: "configuration:namespace",
      ids: ["cluster/demo"],
      expectedEventTypes: ["ADDED"],
      timeoutMs: 1000,
      onTimeout,
    });

    cancelMutationAcksForScope("cluster-a", "configuration:namespace");
    vi.advanceTimersByTime(1000);

    expect(onTimeout).not.toHaveBeenCalled();
  });
});
