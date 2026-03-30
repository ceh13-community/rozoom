import { describe, expect, it } from "vitest";
import { buildRbacMatrix } from "./rbac-matrix";

describe("rbac-matrix", () => {
  it("builds matrix from roles and bindings", () => {
    const result = buildRbacMatrix({
      roles: [
        {
          metadata: { name: "pod-reader" },
          rules: [{ verbs: ["get", "list"], resources: ["pods"], apiGroups: [""] }],
        },
      ],
      clusterRoles: [],
      roleBindings: [
        {
          roleRef: { name: "pod-reader", kind: "Role" },
          subjects: [{ kind: "User", name: "alice", namespace: "default" }],
        },
      ],
      clusterRoleBindings: [],
    });
    expect(result.totalSubjects).toBe(1);
    expect(result.entries[0].subject.name).toBe("alice");
    expect(result.entries[0].permissions).toHaveLength(1);
    expect(result.entries[0].permissions[0].verbs).toEqual(["get", "list"]);
  });

  it("detects cluster-admin bindings", () => {
    const result = buildRbacMatrix({
      roles: [],
      clusterRoles: [
        {
          kind: "ClusterRole",
          metadata: { name: "cluster-admin" },
          rules: [{ verbs: ["*"], resources: ["*"], apiGroups: ["*"] }],
        },
      ],
      roleBindings: [],
      clusterRoleBindings: [
        {
          roleRef: { name: "cluster-admin", kind: "ClusterRole" },
          subjects: [{ kind: "User", name: "admin" }],
        },
      ],
    });
    expect(result.clusterAdminCount).toBe(1);
    expect(result.entries[0].riskScore).toBeGreaterThanOrEqual(300);
    expect(result.entries[0].riskFlags).toContain("Bound to cluster-admin");
  });

  it("aggregates multiple bindings for same subject", () => {
    const result = buildRbacMatrix({
      roles: [
        {
          metadata: { name: "role-a" },
          rules: [{ verbs: ["get"], resources: ["pods"], apiGroups: [""] }],
        },
        {
          metadata: { name: "role-b" },
          rules: [{ verbs: ["get"], resources: ["secrets"], apiGroups: [""] }],
        },
      ],
      clusterRoles: [],
      roleBindings: [
        {
          roleRef: { name: "role-a", kind: "Role" },
          subjects: [{ kind: "ServiceAccount", name: "app-sa", namespace: "default" }],
        },
        {
          roleRef: { name: "role-b", kind: "Role" },
          subjects: [{ kind: "ServiceAccount", name: "app-sa", namespace: "default" }],
        },
      ],
      clusterRoleBindings: [],
    });
    expect(result.totalSubjects).toBe(1);
    expect(result.entries[0].permissions).toHaveLength(2);
    expect(result.entries[0].riskFlags).toContain("Secret read access");
  });

  it("sorts by risk score descending", () => {
    const result = buildRbacMatrix({
      roles: [
        {
          metadata: { name: "safe" },
          rules: [{ verbs: ["get"], resources: ["configmaps"], apiGroups: [""] }],
        },
      ],
      clusterRoles: [
        {
          kind: "ClusterRole",
          metadata: { name: "cluster-admin" },
          rules: [{ verbs: ["*"], resources: ["*"], apiGroups: ["*"] }],
        },
      ],
      roleBindings: [
        { roleRef: { name: "safe", kind: "Role" }, subjects: [{ kind: "User", name: "viewer" }] },
      ],
      clusterRoleBindings: [
        {
          roleRef: { name: "cluster-admin", kind: "ClusterRole" },
          subjects: [{ kind: "User", name: "admin" }],
        },
      ],
    });
    expect(result.entries[0].subject.name).toBe("admin");
    expect(result.entries[1].subject.name).toBe("viewer");
  });

  it("counts high risk subjects", () => {
    const result = buildRbacMatrix({
      roles: [],
      clusterRoles: [
        {
          kind: "ClusterRole",
          metadata: { name: "wildcard" },
          rules: [{ verbs: ["*"], resources: ["*"], apiGroups: ["*"] }],
        },
      ],
      roleBindings: [],
      clusterRoleBindings: [
        {
          roleRef: { name: "wildcard", kind: "ClusterRole" },
          subjects: [
            { kind: "User", name: "user-a" },
            { kind: "User", name: "user-b" },
          ],
        },
      ],
    });
    expect(result.highRiskCount).toBe(2);
    expect(result.wildcardCount).toBe(2);
  });
});
