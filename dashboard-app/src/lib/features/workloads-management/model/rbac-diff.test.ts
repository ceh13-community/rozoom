import { describe, expect, it } from "vitest";
import { diffRbacRoles } from "./rbac-diff";

describe("rbac-diff", () => {
  it("detects identical roles", () => {
    const role = {
      metadata: { name: "reader" },
      rules: [{ verbs: ["get"], resources: ["pods"], apiGroups: [""] }],
    };
    expect(diffRbacRoles(role, role).identical).toBe(true);
  });

  it("detects added resource", () => {
    const left = { metadata: { name: "a" }, rules: [{ verbs: ["get"], resources: ["pods"] }] };
    const right = {
      metadata: { name: "b" },
      rules: [{ verbs: ["get"], resources: ["pods", "services"] }],
    };
    const result = diffRbacRoles(left, right);
    expect(result.addedRules).toBe(1);
  });

  it("detects removed verbs", () => {
    const left = {
      metadata: { name: "a" },
      rules: [{ verbs: ["get", "list", "delete"], resources: ["pods"] }],
    };
    const right = { metadata: { name: "b" }, rules: [{ verbs: ["get"], resources: ["pods"] }] };
    const result = diffRbacRoles(left, right);
    expect(result.modifiedRules).toBe(1);
    expect(result.rules[0].verbs.removed).toContain("delete");
  });
});
