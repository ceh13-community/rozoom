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
      'No access to Secrets: your Kubernetes user is not allowed to list them (RBAC). secrets is forbidden: cannot list resource "secrets" in API group "" at the cluster scope',
    );
  });

  it("leaves the user name out: AWS role ARNs and OIDC emails end up on screenshots", () => {
    for (const user of [
      "arn:aws:iam::123456789012:role/platform-viewer",
      "jane.doe@example.com",
      'odd \\"quoted\\" name',
    ]) {
      const text = describeListError(
        `Error from server (Forbidden): pods is forbidden: User "${user}" cannot list resource "pods" in API group "" in the namespace "shop"`,
        "Pods",
      );
      expect(text).toBe(
        'No access to Pods: your Kubernetes user is not allowed to list them (RBAC). pods is forbidden: cannot list resource "pods" in API group "" in the namespace "shop"',
      );
      expect(text).not.toContain("123456789012");
      expect(text).not.toContain("@example.com");
    }
  });

  it("keeps other failures as load errors", () => {
    expect(describeListError("[ERROR] [t]: Unable to connect to the server", "ConfigMaps")).toBe(
      "Could not load ConfigMaps: Unable to connect to the server",
    );
  });
});
