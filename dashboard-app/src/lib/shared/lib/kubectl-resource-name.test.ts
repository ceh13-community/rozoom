import { describe, expect, it } from "vitest";
import { unsafeKubectlNameReason } from "./kubectl-resource-name";

describe("kubectl resource name guard", () => {
  it("accepts ordinary Kubernetes names", () => {
    for (const name of ["api-0", "kube-system", "my.crd.example.com", "csr-x7k2q", "a_b"]) {
      expect(unsafeKubectlNameReason(name)).toBeNull();
    }
  });

  // Names the API server accepted on a stand (reviewer verdict GKFjp7g8, 05/11/2026).
  it("rejects a CSR name that smuggles a flag", () => {
    expect(unsafeKubectlNameReason("pending-a --as=nobody")).toBe("name contains whitespace");
    expect(unsafeKubectlNameReason("z rev-wipe --patch='data': y")).toBe(
      "name contains whitespace",
    );
  });

  it("rejects a name that is a flag", () => {
    expect(unsafeKubectlNameReason("--all")).toBe("name starts with a dash");
    expect(unsafeKubectlNameReason("-n")).toBe("name starts with a dash");
  });

  it("rejects empty names and control characters", () => {
    expect(unsafeKubectlNameReason("")).toBe("empty name");
    expect(unsafeKubectlNameReason("a\tb")).toBe("name contains whitespace");
    expect(unsafeKubectlNameReason("a\nb")).toBe("name contains whitespace");
    expect(unsafeKubectlNameReason("a\u0007b")).toBe("name contains control characters");
  });
});
