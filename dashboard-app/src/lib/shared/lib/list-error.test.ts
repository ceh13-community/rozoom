import { describe, expect, it } from "vitest";
import { describeListError } from "./list-error";

describe("describeListError", () => {
  it("says Forbidden is about access, with kubectl's reason", () => {
    expect(
      describeListError(
        '[ERROR] [2026-11-22T03:27:34.009Z]: Error from server (Forbidden): secrets is forbidden: User "system:serviceaccount:dem:viewer" cannot list resource "secrets" in API group "" at the cluster scope\n',
        "Secrets",
      ),
    ).toBe(
      'No access to Secrets: your Kubernetes user is not allowed to list them (RBAC). secrets is forbidden: User "system:serviceaccount:dem:viewer" cannot list resource "secrets" in API group "" at the cluster scope',
    );
  });

  it("keeps other failures as load errors", () => {
    expect(describeListError("[ERROR] [t]: Unable to connect to the server", "ConfigMaps")).toBe(
      "Could not load ConfigMaps: Unable to connect to the server",
    );
  });
});
