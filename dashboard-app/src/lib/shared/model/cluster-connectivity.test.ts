import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clusterConnectivity,
  formatContactTime,
  isClusterDisconnected,
  recordServerVersion,
  reportClusterAnswered,
  reportClusterLoadError,
  reportKubectlOutcome,
  resetClusterConnectivity,
  selectClusterConnectivity,
} from "./cluster-connectivity";

const NO_ROUTE =
  "Unable to connect to the server: dial tcp 192.168.49.2:8443: connect: no route to host";

describe("cluster connectivity", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetClusterConnectivity();
    vi.useRealTimers();
  });

  it("starts unknown", () => {
    expect(get(selectClusterConnectivity("a")).state).toBe("unknown");
  });

  it("goes unreachable with a human reason on a network failure", () => {
    reportKubectlOutcome("a", { code: 1, stderr: `[ERROR] [t]: ${NO_ROUTE}` });
    const entry = get(selectClusterConnectivity("a"));
    expect(entry).toMatchObject({
      state: "unreachable",
      reason: "No route to the cluster address",
      detail: NO_ROUTE,
    });
    expect(isClusterDisconnected(entry)).toBe(true);
  });

  it("goes auth-expired on a 401", () => {
    reportKubectlOutcome("a", {
      code: 1,
      stderr: "error: You must be logged in to the server (Unauthorized)",
    });
    expect(get(selectClusterConnectivity("a"))).toMatchObject({
      state: "auth-expired",
      reason: "Credentials expired or rejected",
    });
  });

  it("goes back online on the next answer and records the contact time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T14:02:00Z"));
    reportKubectlOutcome("a", { code: 1, stderr: NO_ROUTE });
    reportKubectlOutcome("a", { code: 0, stderr: "" });
    expect(get(selectClusterConnectivity("a"))).toMatchObject({
      state: "online",
      reason: null,
      lastContactAt: Date.parse("2026-11-16T14:02:00Z"),
    });
  });

  it("treats a 403 as online: the server answered", () => {
    reportKubectlOutcome("a", {
      code: 1,
      stderr: 'Error from server (Forbidden): pods is forbidden: User "viewer" cannot list',
    });
    expect(get(selectClusterConnectivity("a")).state).toBe("online");
  });

  it("ignores local kubectl errors that say nothing about the network", () => {
    reportKubectlOutcome("a", { code: 0, stderr: "" });
    reportKubectlOutcome("a", { code: 1, stderr: "error: unknown flag: --bogus" });
    expect(get(selectClusterConnectivity("a")).state).toBe("online");
  });

  it("keeps clusters apart and ignores calls without a cluster", () => {
    reportKubectlOutcome("a", { code: 1, stderr: NO_ROUTE });
    reportKubectlOutcome("b", { code: 0, stderr: "" });
    reportKubectlOutcome(undefined, { code: 1, stderr: NO_ROUTE });
    const state = get(clusterConnectivity);
    expect(state.a.state).toBe("unreachable");
    expect(state.b.state).toBe("online");
    expect(Object.keys(state).sort()).toEqual(["a", "b"]);
  });

  it("records no verdict when kubectl was killed (abort or timeout)", () => {
    reportKubectlOutcome("a", { code: 0, stderr: "" });
    reportKubectlOutcome("a", { code: null, stderr: NO_ROUTE });
    expect(get(selectClusterConnectivity("a")).state).toBe("online");
  });

  it("takes the health check's load error and its fresh answers", () => {
    reportClusterLoadError("a", `Failed to load nodes: ${NO_ROUTE}`);
    expect(get(selectClusterConnectivity("a")).state).toBe("unreachable");
    reportClusterAnswered("a");
    expect(get(selectClusterConnectivity("a")).state).toBe("online");
    reportClusterLoadError("a", "Failed to load cluster data");
    expect(get(selectClusterConnectivity("a")).state).toBe("online");
  });

  it("keeps the last known version across a restart", () => {
    recordServerVersion("a", "v1.31.0");
    resetClusterConnectivity();
    expect(get(selectClusterConnectivity("a")).lastKnownVersion).toBe("v1.31.0");
  });

  it("restores the last contact time after a restart, but not the state", () => {
    reportKubectlOutcome("a", { code: 0, stderr: "" });
    const contact = get(selectClusterConnectivity("a")).lastContactAt;
    resetClusterConnectivity();
    expect(get(selectClusterConnectivity("a"))).toMatchObject({
      state: "unknown",
      lastContactAt: contact,
    });
  });

  it("formats the contact time as a clock time today and with the date otherwise", () => {
    const now = new Date(2026, 10, 16, 18, 0).getTime();
    expect(formatContactTime(new Date(2026, 10, 16, 14, 2).getTime(), now)).toBe("14:02");
    expect(formatContactTime(new Date(2026, 10, 15, 9, 5).getTime(), now)).toBe("15 Nov 09:05");
  });
});
