import { describe, expect, it } from "vitest";
import { humanizeCertError } from "./humanize";

describe("humanizeCertError", () => {
  it("flags already-approved CSR", () => {
    expect(humanizeCertError("csr already approved by another approver").title).toBe(
      "CSR already approved",
    );
  });

  it("flags denied/rejected CSR", () => {
    expect(humanizeCertError("the csr was denied").title).toBe("CSR was denied");
    expect(humanizeCertError("rejected by controller").title).toBe("CSR was denied");
  });

  it("flags RBAC on certificatesigningrequest specifically", () => {
    expect(
      humanizeCertError("user 'foo' is forbidden: cannot approve certificatesigningrequest").title,
    ).toBe("RBAC forbids CSR approval");
  });

  it("falls through to generic RBAC for other forbidden ops", () => {
    expect(humanizeCertError("User system:anonymous is forbidden").title).toBe("Permission denied");
  });

  it("flags CSR not found", () => {
    expect(humanizeCertError("csr foo not found").title).toBe("CSR not found");
  });

  it("flags kubeadm failure", () => {
    expect(humanizeCertError("kubeadm failed: exit status 1").title).toBe(
      "kubeadm renewal failed inside the apiserver pod",
    );
  });

  it("flags missing kubectl exec", () => {
    expect(humanizeCertError("exec format not found").title).toBe(
      "kubectl exec not supported on the apiserver pod",
    );
  });

  it("flags x509 / certificate errors", () => {
    expect(humanizeCertError("x509: certificate has expired").title).toBe(
      "TLS error talking to the API server",
    );
  });

  it("flags network unreachable", () => {
    expect(humanizeCertError("dial tcp: connection refused").title).toBe("API server unreachable");
  });

  it("falls through to generic for unknown errors", () => {
    const r = humanizeCertError("random unknown stderr");
    expect(r.title).toBe("Certificate action failed");
    expect(r.hint).toBeNull();
  });
});
