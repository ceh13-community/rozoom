import { describe, expect, it } from "vitest";
import { normalizeRbacRoles } from "./kubectl-to-rbac";

describe("normalizeRbacRoles", () => {
  it("maps ClusterRole items with full rule shape", () => {
    const input = {
      items: [
        {
          kind: "ClusterRole",
          metadata: { name: "cluster-admin" },
          rules: [{ apiGroups: ["*"], resources: ["*"], verbs: ["*"] }],
        },
      ],
    };
    const result = normalizeRbacRoles(input, null);
    expect(result).toEqual([
      {
        name: "cluster-admin",
        namespace: null,
        kind: "ClusterRole",
        rules: [{ apiGroups: ["*"], resources: ["*"], verbs: ["*"] }],
      },
    ]);
  });

  it("maps namespaced Role items", () => {
    const input = {
      items: [
        {
          kind: "Role",
          metadata: { name: "ns-reader", namespace: "team-a" },
          rules: [{ apiGroups: [""], resources: ["pods"], verbs: ["get", "list"] }],
        },
      ],
    };
    const result = normalizeRbacRoles(null, input);
    expect(result[0]?.namespace).toBe("team-a");
    expect(result[0]?.kind).toBe("Role");
  });

  it("combines ClusterRole and Role inputs", () => {
    const cr = { items: [{ kind: "ClusterRole", metadata: { name: "view" }, rules: [] }] };
    const r = {
      items: [{ kind: "Role", metadata: { name: "edit", namespace: "default" }, rules: [] }],
    };
    const result = normalizeRbacRoles(cr, r);
    expect(result).toHaveLength(2);
    expect(result.map((x) => x.name)).toEqual(["view", "edit"]);
  });

  it("defaults missing rule arrays to empty", () => {
    const input = { items: [{ kind: "ClusterRole", metadata: { name: "noop" }, rules: [{}] }] };
    const result = normalizeRbacRoles(input, null);
    expect(result[0]?.rules).toEqual([{ apiGroups: [], resources: [], verbs: [] }]);
  });

  it("skips items without a name (nothing can reference them)", () => {
    const input = { items: [{ kind: "ClusterRole", rules: [] }] };
    const result = normalizeRbacRoles(input, null);
    expect(result).toHaveLength(0);
  });

  it("treats unknown kind on ClusterRole response as ClusterRole", () => {
    const input = { items: [{ metadata: { name: "legacy" }, rules: [] }] };
    const result = normalizeRbacRoles(input, null);
    expect(result[0]?.kind).toBe("ClusterRole");
    expect(result[0]?.namespace).toBeNull();
  });

  it("returns empty list when both responses are null (cluster unreachable)", () => {
    expect(normalizeRbacRoles(null, null)).toEqual([]);
  });
});
