import { describe, expect, it, vi } from "vitest";

vi.mock("../api/check-hpa", () => ({ checkHpaStatus: vi.fn() }));
vi.mock("../api/check-vpa-status", () => ({ checkVpaStatus: vi.fn() }));
vi.mock("../api/check-ingress-status", () => ({ checkIngressStatus: vi.fn() }));
vi.mock("../api/check-rbac-overview", () => ({ checkRbacOverview: vi.fn() }));
vi.mock("./cache-store", () => ({ updateClusterCheckPartially: vi.fn() }));

import {
  loadPostureChecks,
  missingPostureChecks,
  POSTURE_CHECK_FIELDS,
  POSTURE_CHECK_MAX_AGE_MS,
  takeDuePostureChecks,
} from "./posture-checks";
import type { ClusterHealthChecks } from "./types";

const NOW = 1_000_000_000;
const fresh = { status: "ok", updatedAt: NOW - 1_000 };

const withReports = (reports: Record<string, unknown>) =>
  ({ timestamp: NOW, ...reports }) as unknown as ClusterHealthChecks;

describe("missingPostureChecks", () => {
  it("asks for all four before any check ran", () => {
    expect(missingPostureChecks(null, NOW)).toEqual([...POSTURE_CHECK_FIELDS]);
    expect(missingPostureChecks(withReports({}), NOW)).toEqual([...POSTURE_CHECK_FIELDS]);
  });

  it("asks for nothing when every report is recent", () => {
    const check = withReports({
      hpaStatus: fresh,
      vpaStatus: { status: "warning", updatedAt: NOW },
      ingressStatus: fresh,
      rbacOverview: fresh,
    });
    expect(missingPostureChecks(check, NOW)).toEqual([]);
  });

  it("asks again for placeholder, stale and undated reports", () => {
    const check = withReports({
      hpaStatus: { status: "unknown", updatedAt: NOW },
      vpaStatus: { status: "ok", updatedAt: NOW - POSTURE_CHECK_MAX_AGE_MS - 1 },
      ingressStatus: { status: "ok" },
      rbacOverview: fresh,
    });
    expect(missingPostureChecks(check, NOW)).toEqual(["hpaStatus", "vpaStatus", "ingressStatus"]);
  });
});

// Each open of an Overview mounts a new component; RBAC without rights stays "unknown".
describe("takeDuePostureChecks", () => {
  // Every report recent at `at`, except RBAC, which could not read the cluster.
  const unreadableAt = (at: number) =>
    withReports({
      hpaStatus: { status: "ok", updatedAt: at },
      vpaStatus: { status: "ok", updatedAt: at },
      ingressStatus: { status: "ok", updatedAt: at },
      rbacOverview: { status: "unknown", updatedAt: at },
    });

  it("asks once per max age, however often the Overview opens", () => {
    const gate = new Map<string, number>();
    const ask = (at: number) => takeDuePostureChecks("c1", unreadableAt(at), at, gate);
    expect(ask(NOW)).toEqual(["rbacOverview"]);
    expect(ask(NOW + 1_000)).toEqual([]);
    expect(ask(NOW + POSTURE_CHECK_MAX_AGE_MS - 1)).toEqual([]);
    expect(ask(NOW + POSTURE_CHECK_MAX_AGE_MS)).toEqual(["rbacOverview"]);
  });

  it("gates each cluster and each check on its own", () => {
    const gate = new Map<string, number>();
    expect(takeDuePostureChecks("c1", unreadableAt(NOW), NOW, gate)).toEqual(["rbacOverview"]);
    expect(takeDuePostureChecks("c2", unreadableAt(NOW), NOW, gate)).toEqual(["rbacOverview"]);
    expect(takeDuePostureChecks("c1", null, NOW + 1_000, gate)).toEqual([
      "hpaStatus",
      "vpaStatus",
      "ingressStatus",
    ]);
  });

  it("uses one gate across callers by default", () => {
    const check = unreadableAt(Date.now());
    expect(takeDuePostureChecks("shared", check)).toEqual(["rbacOverview"]);
    expect(takeDuePostureChecks("shared", check)).toEqual([]);
  });
});

describe("loadPostureChecks", () => {
  const runnersFor = (results: Record<string, () => Promise<unknown>>) => ({
    hpaStatus: vi.fn(results.hpaStatus ?? (() => Promise.resolve({ status: "ok" }))),
    vpaStatus: vi.fn(results.vpaStatus ?? (() => Promise.resolve({ status: "ok" }))),
    ingressStatus: vi.fn(results.ingressStatus ?? (() => Promise.resolve({ status: "ok" }))),
    rbacOverview: vi.fn(results.rbacOverview ?? (() => Promise.resolve({ status: "ok" }))),
  });

  it("runs only the requested checks and stores them in one update", async () => {
    const runners = runnersFor({});
    const store = vi.fn().mockResolvedValue(undefined);
    const loaded = await loadPostureChecks("c1", ["hpaStatus", "rbacOverview"], runners, store);
    expect(loaded).toEqual(["hpaStatus", "rbacOverview"]);
    expect(runners.vpaStatus).not.toHaveBeenCalled();
    expect(runners.ingressStatus).not.toHaveBeenCalled();
    expect(runners.hpaStatus).toHaveBeenCalledWith("c1");
    expect(store).toHaveBeenCalledTimes(1);
    expect(store).toHaveBeenCalledWith("c1", {
      hpaStatus: { status: "ok" },
      rbacOverview: { status: "ok" },
    });
  });

  it("leaves a failed check out instead of failing the rest", async () => {
    const runners = runnersFor({
      vpaStatus: () => Promise.reject(new Error("forbidden")),
      ingressStatus: () => Promise.resolve(null),
    });
    const store = vi.fn().mockResolvedValue(undefined);
    const loaded = await loadPostureChecks("c1", [...POSTURE_CHECK_FIELDS], runners, store);
    expect(loaded).toEqual(["hpaStatus", "rbacOverview"]);
    expect(Object.keys(store.mock.calls[0][1] as object)).toEqual(["hpaStatus", "rbacOverview"]);
  });

  it("stores nothing when every check failed", async () => {
    const failing = () => Promise.reject(new Error("offline"));
    const runners = runnersFor({
      hpaStatus: failing,
      vpaStatus: failing,
      ingressStatus: failing,
      rbacOverview: failing,
    });
    const store = vi.fn();
    expect(await loadPostureChecks("c1", [...POSTURE_CHECK_FIELDS], runners, store)).toEqual([]);
    expect(store).not.toHaveBeenCalled();
  });
});
