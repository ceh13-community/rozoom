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
