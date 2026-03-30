import { describe, expect, it } from "vitest";
import { analyzeLeastPrivilege } from "./least-privilege";

describe("least-privilege", () => {
  it("finds unused verbs", () => {
    const result = analyzeLeastPrivilege(
      [
        {
          name: "app-sa",
          kind: "ServiceAccount",
          namespace: "default",
          permissions: [{ resource: "pods", verbs: ["get", "list", "delete", "create"] }],
        },
      ],
      [
        { subjectName: "app-sa", resource: "pods", verb: "get" },
        { subjectName: "app-sa", resource: "pods", verb: "list" },
      ],
    );
    expect(result.entries[0].gaps[0].unusedVerbs).toEqual(["delete", "create"]);
    expect(result.entries[0].overallReductionPercent).toBe(50);
  });

  it("marks acceptable when all used", () => {
    const result = analyzeLeastPrivilege(
      [
        {
          name: "sa",
          kind: "ServiceAccount",
          namespace: "ns",
          permissions: [{ resource: "pods", verbs: ["get"] }],
        },
      ],
      [{ subjectName: "sa", resource: "pods", verb: "get" }],
    );
    expect(result.overprivilegedCount).toBe(0);
  });
});
