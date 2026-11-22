import { describe, expect, it } from "vitest";
import { triageScorers } from "./triage-scorers";

describe("triage scorers", () => {
  it("scores pods with restarts and pending phase", () => {
    const result = triageScorers.pods(
      {
        metadata: { name: "pod-a", namespace: "default" },
        status: {
          phase: "Pending",
          containerStatuses: [{ restartCount: 2 }],
        },
      },
      { entry: {} as never, items: [] },
    );

    expect(result.problemScore).toBeGreaterThan(0);
    expect(result.status).toBe("Pending");
    expect(result.reason).toContain("restarts");
  });

  // Triage showed "Running" for a pod in CrashLoopBackOff: the phase stays Running.
  it("shows a crashing pod's waiting reason, not its phase", () => {
    const crashing = triageScorers.pods(
      {
        metadata: { name: "api", namespace: "shop" },
        status: {
          phase: "Running",
          containerStatuses: [
            { restartCount: 200, state: { waiting: { reason: "CrashLoopBackOff" } } },
          ],
        },
      },
      { entry: {} as never, items: [] },
    );
    expect(crashing.status).toBe("CrashLoopBackOff");

    const deleting = triageScorers.pods(
      {
        metadata: { name: "api", namespace: "shop", deletionTimestamp: "2026-11-22T06:00:00Z" },
        status: { phase: "Running", containerStatuses: [{ restartCount: 0 }] },
      },
      { entry: {} as never, items: [] },
    );
    expect(deleting.status).toBe("Terminating");
  });

  it("scores services without ports as problematic", () => {
    const result = triageScorers.services(
      {
        metadata: { name: "svc-a", namespace: "default" },
        spec: { type: "ClusterIP", ports: [] },
      },
      { entry: {} as never, items: [] },
    );

    expect(result.problemScore).toBe(140);
    expect(result.reason).toBe("no service ports defined");
  });

  it("scores wildcard RBAC roles as risky", () => {
    const result = triageScorers.roles(
      {
        metadata: { name: "role-a", namespace: "default" },
        rules: [{ apiGroups: ["*"], resources: ["pods"], verbs: ["get"] }],
      },
      { entry: {} as never, items: [] },
    );

    expect(result.problemScore).toBeGreaterThan(0);
    expect(result.reason).toContain("wildcard");
  });
});
