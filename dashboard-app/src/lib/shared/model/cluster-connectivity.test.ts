import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimReconnectReload,
  clusterConnectivity,
  CONNECTIVITY_CHECK_SOURCE,
  formatContactTime,
  registerConnectivityConfirmation,
  isClusterDisconnected,
  recordServerVersion,
  reportClusterAnswered,
  reportClusterNoAnswer,
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
    registerConnectivityConfirmation(null);
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

  describe("calls that finish out of order", () => {
    const REFUSED =
      "The connection to the server 127.0.0.1:6443 was refused - did you specify the right host or port?";

    it("keeps a Retry's answer when an older call fails after it", () => {
      // A list request starts at 1000 and hangs; Retry starts at 5000 and answers.
      reportKubectlOutcome("a", { code: 0, stderr: "" }, { startedAt: 5_000 });
      reportKubectlOutcome("a", { code: 1, stderr: REFUSED }, { startedAt: 1_000 });
      expect(get(selectClusterConnectivity("a")).state).toBe("online");
    });

    it("keeps a newer failure when an older call answers after it", () => {
      reportKubectlOutcome("a", { code: 1, stderr: REFUSED }, { startedAt: 5_000 });
      reportKubectlOutcome("a", { code: 0, stderr: "" }, { startedAt: 1_000 });
      expect(get(selectClusterConnectivity("a"))).toMatchObject({
        state: "unreachable",
        reason: "Connection refused",
      });
    });

    it("drops a check that gave up when a newer call has answered", () => {
      reportKubectlOutcome("a", { code: 0, stderr: "" }, { startedAt: 10_000 });
      reportClusterNoAnswer("a", "Gave up after 35 s", 5_000);
      expect(get(selectClusterConnectivity("a")).state).toBe("online");
    });
  });

  describe("a timeout on an ordinary call", () => {
    const TIMEOUT = "Unable to connect to the server: dial tcp 10.0.0.1:6443: i/o timeout";

    it("leaves a live cluster online and asks for one check", () => {
      const runner = vi.fn();
      registerConnectivityConfirmation(runner);
      reportKubectlOutcome("a", { code: 0, stderr: "" }, { startedAt: 1_000 });
      reportKubectlOutcome("a", { code: 1, stderr: TIMEOUT }, { startedAt: 2_000 });
      reportKubectlOutcome("a", { code: 1, stderr: TIMEOUT }, { startedAt: 3_000 });
      expect(get(selectClusterConnectivity("a")).state).toBe("online");
      expect(runner).toHaveBeenCalledTimes(1);
      expect(runner).toHaveBeenCalledWith("a");
    });

    it("does not ask again within 30 s", () => {
      vi.useFakeTimers();
      vi.setSystemTime(100_000);
      const runner = vi.fn();
      registerConnectivityConfirmation(runner);
      reportKubectlOutcome("a", { code: 1, stderr: TIMEOUT });
      vi.setSystemTime(129_000);
      reportKubectlOutcome("a", { code: 1, stderr: TIMEOUT });
      expect(runner).toHaveBeenCalledTimes(1);
      vi.setSystemTime(131_000);
      reportKubectlOutcome("a", { code: 1, stderr: TIMEOUT });
      expect(runner).toHaveBeenCalledTimes(2);
    });

    it("is written by the check itself", () => {
      const runner = vi.fn();
      registerConnectivityConfirmation(runner);
      reportKubectlOutcome("a", { code: 0, stderr: "" }, { startedAt: 1_000 });
      reportKubectlOutcome(
        "a",
        { code: 1, stderr: TIMEOUT },
        { startedAt: 2_000, source: CONNECTIVITY_CHECK_SOURCE },
      );
      expect(get(selectClusterConnectivity("a"))).toMatchObject({
        state: "unreachable",
        reason: "No answer from the server",
      });
      expect(runner).not.toHaveBeenCalled();
    });

    it("from the health check also only asks for the check", () => {
      const runner = vi.fn();
      registerConnectivityConfirmation(runner);
      reportKubectlOutcome("a", { code: 0, stderr: "" }, { startedAt: 1_000 });
      reportClusterLoadError("a", `Failed to load pods: ${TIMEOUT}`, { startedAt: 2_000 });
      expect(get(selectClusterConnectivity("a")).state).toBe("online");
      expect(runner).toHaveBeenCalledTimes(1);
    });
  });

  it("does not rewrite the store for every answer of a steady cluster", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    reportKubectlOutcome("a", { code: 0, stderr: "" });
    let writes = 0;
    const unsubscribe = clusterConnectivity.subscribe(() => {
      writes += 1;
    });
    writes = 0;
    for (let step = 1; step <= 10; step += 1) {
      vi.setSystemTime(1_000_000 + step * 1_000);
      reportKubectlOutcome("a", { code: 0, stderr: "" });
    }
    expect(writes).toBe(0);
    vi.setSystemTime(1_016_000);
    reportKubectlOutcome("a", { code: 0, stderr: "" });
    expect(writes).toBe(1);
    unsubscribe();
  });

  it("lets each view reload after a reconnect at most once a minute per cluster", () => {
    expect(claimReconnectReload("a", "card", 0)).toBe(true);
    expect(claimReconnectReload("a", "card", 59_000)).toBe(false);
    expect(claimReconnectReload("a", "pods", 59_000)).toBe(true);
    expect(claimReconnectReload("b", "card", 59_000)).toBe(true);
    expect(claimReconnectReload("a", "card", 60_000)).toBe(true);
  });
});
