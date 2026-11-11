import { describe, expect, it } from "vitest";
import {
  buildDeleteConfirmMessage,
  countDeletedObjects,
  parseDeleteDryRunNames,
} from "./delete-confirmation";

describe("delete confirmation", () => {
  it("lists the objects the server dry run would delete", () => {
    const names = parseDeleteDryRunNames(
      [
        "role.rbac.authorization.k8s.io/reader",
        "role.rbac.authorization.k8s.io/writer (server dry run)",
        "",
        "role.rbac.authorization.k8s.io/admin",
      ].join("\n"),
    );
    expect(names).toEqual([
      "role.rbac.authorization.k8s.io/reader",
      "role.rbac.authorization.k8s.io/writer",
      "role.rbac.authorization.k8s.io/admin",
    ]);
    expect(parseDeleteDryRunNames("")).toEqual([]);
    expect(parseDeleteDryRunNames(undefined)).toEqual([]);
  });

  it("counts the dry-run objects, not the selected rows", () => {
    // One selected row whose delete would remove three objects must say three.
    const message = buildDeleteConfirmMessage([
      "role.rbac.authorization.k8s.io/a",
      "role.rbac.authorization.k8s.io/b",
      "role.rbac.authorization.k8s.io/c",
    ]);
    expect(message.split("\n")[0]).toBe("Delete 3 objects? This cannot be undone.");
    expect(message).toContain("role.rbac.authorization.k8s.io/c");
    expect(buildDeleteConfirmMessage(["configmap/app"]).split("\n")[0]).toBe(
      "Delete 1 object? This cannot be undone.",
    );
  });

  it("caps the list at ten names and says how many are left", () => {
    const names = Array.from({ length: 13 }, (_, i) => `secret/s${i}`);
    const lines = buildDeleteConfirmMessage(names).split("\n");
    expect(lines).toContain("secret/s9");
    expect(lines).not.toContain("secret/s10");
    expect(lines).toContain("and 3 more");
  });

  it("warns that a namespace takes its contents with it", () => {
    const message = buildDeleteConfirmMessage(["namespace/team-a"], { namespaces: true });
    expect(message.split("\n")[0]).toBe("Delete 1 namespace? This cannot be undone.");
    expect(message).toContain("Everything inside is deleted too.");
  });

  it("counts deleted objects from kubectl output, old and new formats", () => {
    const output = [
      'role.rbac.authorization.k8s.io "a" deleted',
      'role.rbac.authorization.k8s.io "b" deleted from default namespace',
      "warning: something unrelated",
    ].join("\n");
    expect(countDeletedObjects(output)).toBe(2);
    expect(countDeletedObjects("")).toBe(0);
  });
});
