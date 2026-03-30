import { describe, expect, it } from "vitest";
import { scanRoleRisks, buildRbacRiskReport } from "./rbac-risk-scanner";

describe("rbac-risk-scanner", () => {
  it("flags wildcard permissions as critical", () => {
    const result = scanRoleRisks({
      name: "super-admin",
      namespace: null,
      kind: "ClusterRole",
      rules: [{ apiGroups: ["*"], resources: ["*"], verbs: ["*"] }],
    });

    expect(result.highestRisk).toBe("critical");
    expect(result.findings.some((f) => f.rule === "wildcard-all")).toBe(true);
  });

  it("flags escalate verb as critical", () => {
    const result = scanRoleRisks({
      name: "role-manager",
      namespace: null,
      kind: "ClusterRole",
      rules: [
        { apiGroups: ["rbac.authorization.k8s.io"], resources: ["roles"], verbs: ["escalate"] },
      ],
    });

    expect(result.highestRisk).toBe("critical");
    expect(result.findings.some((f) => f.rule === "escalate-roles")).toBe(true);
  });

  it("flags secrets list/watch as high", () => {
    const result = scanRoleRisks({
      name: "secret-reader",
      namespace: "default",
      kind: "Role",
      rules: [{ apiGroups: [""], resources: ["secrets"], verbs: ["list", "watch"] }],
    });

    expect(result.highestRisk).toBe("high");
    expect(result.findings.some((f) => f.rule === "secrets-list-watch")).toBe(true);
  });

  it("flags pods/exec create as high", () => {
    const result = scanRoleRisks({
      name: "exec-role",
      namespace: "default",
      kind: "Role",
      rules: [{ apiGroups: [""], resources: ["pods/exec"], verbs: ["create"] }],
    });

    expect(result.findings.some((f) => f.rule === "pods-exec")).toBe(true);
  });

  it("flags nodes/proxy as critical", () => {
    const result = scanRoleRisks({
      name: "kubelet-proxy",
      namespace: null,
      kind: "ClusterRole",
      rules: [{ apiGroups: [""], resources: ["nodes/proxy"], verbs: ["get"] }],
    });

    expect(result.highestRisk).toBe("critical");
  });

  it("flags pod creation as medium risk", () => {
    const result = scanRoleRisks({
      name: "deployer",
      namespace: "prod",
      kind: "Role",
      rules: [{ apiGroups: [""], resources: ["pods"], verbs: ["create", "get", "list"] }],
    });

    expect(result.highestRisk).toBe("medium");
    expect(result.findings.some((f) => f.rule === "pods-create")).toBe(true);
  });

  it("returns low risk for safe roles", () => {
    const result = scanRoleRisks({
      name: "viewer",
      namespace: "default",
      kind: "Role",
      rules: [
        { apiGroups: [""], resources: ["pods", "services"], verbs: ["get", "list", "watch"] },
      ],
    });

    expect(result.highestRisk).toBe("low");
    expect(result.findings).toHaveLength(0);
    expect(result.riskScore).toBe(0);
  });

  it("accumulates risk score from multiple findings", () => {
    const result = scanRoleRisks({
      name: "dangerous",
      namespace: null,
      kind: "ClusterRole",
      rules: [
        { apiGroups: [""], resources: ["secrets"], verbs: ["list"] },
        { apiGroups: [""], resources: ["pods/exec"], verbs: ["create"] },
      ],
    });

    expect(result.findings).toHaveLength(2);
    expect(result.riskScore).toBe(40); // 20 + 20
  });

  it("builds report sorted by risk score", () => {
    const report = buildRbacRiskReport([
      {
        name: "viewer",
        namespace: null,
        kind: "ClusterRole",
        rules: [{ apiGroups: [""], resources: ["pods"], verbs: ["get"] }],
      },
      {
        name: "admin",
        namespace: null,
        kind: "ClusterRole",
        rules: [{ apiGroups: ["*"], resources: ["*"], verbs: ["*"] }],
      },
      {
        name: "editor",
        namespace: "ns",
        kind: "Role",
        rules: [{ apiGroups: [""], resources: ["secrets"], verbs: ["list"] }],
      },
    ]);

    expect(report.roles[0]!.name).toBe("admin");
    expect(report.summary.criticalCount).toBe(1);
    expect(report.summary.highCount).toBe(1);
    expect(report.summary.cleanCount).toBe(1);
  });
});
