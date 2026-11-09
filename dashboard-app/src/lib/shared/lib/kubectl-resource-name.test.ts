import { describe, expect, it } from "vitest";
import {
  assertSafeKubectlName,
  isSafeKubectlName,
  unsafeKubectlNameReason,
} from "./kubectl-resource-name";

describe("kubectl resource name guard", () => {
  it("accepts ordinary Kubernetes names", () => {
    for (const name of ["api-0", "kube-system", "my.crd.example.com", "csr-x7k2q", "a_b"]) {
      expect(unsafeKubectlNameReason(name)).toBeNull();
      expect(isSafeKubectlName(name)).toBe(true);
      expect(assertSafeKubectlName(name)).toBe(name);
    }
  });

  // Names the API server accepted on a stand (reviewer verdict GKFjp7g8, 05/11/2026).
  it("rejects a CSR name that smuggles a flag", () => {
    expect(unsafeKubectlNameReason("pending-a --as=nobody")).toBe("name contains whitespace");
  });

  it("rejects a Role called --all", () => {
    expect(unsafeKubectlNameReason("--all")).toBe("name starts with a dash");
    expect(isSafeKubectlName("-n")).toBe(false);
  });

  it("rejects empty names and control characters", () => {
    expect(unsafeKubectlNameReason("")).toBe("empty name");
    expect(unsafeKubectlNameReason("a\tb")).toBe("name contains whitespace");
    expect(unsafeKubectlNameReason("a\nb")).toBe("name contains whitespace");
    expect(unsafeKubectlNameReason("a\u0007b")).toBe("name contains control characters");
  });

  it("throws a plain-language error with the kind and the quoted name", () => {
    expect(() => assertSafeKubectlName("--all", "role")).toThrow(
      'Refusing to pass role name "--all" to kubectl: name starts with a dash.',
    );
  });
});
