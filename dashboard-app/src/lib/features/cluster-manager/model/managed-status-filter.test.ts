import { describe, expect, it } from "vitest";
import { matchesManagedStatusFilter } from "./managed-status-filter";

describe("matchesManagedStatusFilter", () => {
  const reachable = { offline: false, liveProblem: null };
  const unreachable = { offline: false, liveProblem: "Unreachable" };
  const authExpired = { offline: false, liveProblem: "Auth expired" };
  const switchedOff = { offline: true, liveProblem: null };

  it("keeps a cluster the live probe cannot reach out of Online only", () => {
    expect(matchesManagedStatusFilter("online", reachable)).toBe(true);
    expect(matchesManagedStatusFilter("online", unreachable)).toBe(false);
    expect(matchesManagedStatusFilter("online", authExpired)).toBe(false);
    expect(matchesManagedStatusFilter("online", switchedOff)).toBe(false);
  });

  it("puts every cluster that does not read Online into Offline only", () => {
    expect(matchesManagedStatusFilter("offline", reachable)).toBe(false);
    expect(matchesManagedStatusFilter("offline", unreachable)).toBe(true);
    expect(matchesManagedStatusFilter("offline", authExpired)).toBe(true);
    expect(matchesManagedStatusFilter("offline", switchedOff)).toBe(true);
  });

  it("shows everything without a status filter", () => {
    expect(matchesManagedStatusFilter("all", unreachable)).toBe(true);
    expect(matchesManagedStatusFilter("all", reachable)).toBe(true);
  });
});
