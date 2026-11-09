import { describe, expect, it } from "vitest";
import {
  evaluateTlsGate,
  kubeconfigTlsYaml,
  TlsBlockedError,
  type TlsGateResult,
} from "./tls-gate";

/** Assert the gate blocked and narrow to the blocking variant so `reason` is typed. */
function expectBlocked(gate: TlsGateResult): { allowed: false; reason: string } {
  expect(gate.allowed).toBe(false);
  if (gate.allowed) throw new Error("expected TLS gate to block the connection");
  return gate;
}

describe("evaluateTlsGate", () => {
  it("allows a remote https cluster that has a CA", () => {
    const gate = evaluateTlsGate({
      server: "https://api.prod.example.com:6443",
      hasCertificateAuthority: true,
      insecureSkipTlsVerify: false,
    });
    expect(gate.allowed).toBe(true);
  });

  it("blocks insecure-skip-tls-verify regardless of CA", () => {
    const gate = evaluateTlsGate({
      server: "https://api.prod.example.com:6443",
      hasCertificateAuthority: true,
      insecureSkipTlsVerify: true,
    });
    expect(expectBlocked(gate).reason).toMatch(/insecure-skip-tls-verify|verification/i);
  });

  it("blocks a remote https cluster with no CA", () => {
    const gate = evaluateTlsGate({
      server: "https://api.prod.example.com:6443",
      hasCertificateAuthority: false,
      insecureSkipTlsVerify: false,
    });
    expect(expectBlocked(gate).reason).toMatch(/CA certificate/i);
  });

  it("allows a loopback cluster without a CA (local dev)", () => {
    for (const server of [
      "https://localhost:6443",
      "https://127.0.0.1:6443",
      "https://[::1]:6443",
    ]) {
      const gate = evaluateTlsGate({
        server,
        hasCertificateAuthority: false,
        insecureSkipTlsVerify: false,
      });
      expect(gate.allowed, server).toBe(true);
    }
  });

  it("still blocks insecure-skip-tls-verify even on loopback", () => {
    const gate = evaluateTlsGate({
      server: "https://127.0.0.1:6443",
      hasCertificateAuthority: false,
      insecureSkipTlsVerify: true,
    });
    expect(gate.allowed).toBe(false);
  });

  it("blocks a remote cluster served over plain http", () => {
    const gate = evaluateTlsGate({
      server: "http://api.prod.example.com:8080",
      hasCertificateAuthority: false,
      insecureSkipTlsVerify: false,
    });
    expect(expectBlocked(gate).reason).toMatch(/http|HTTPS/i);
  });

  it("blocks when the server URL is missing or unparseable", () => {
    expect(
      evaluateTlsGate({ server: "", hasCertificateAuthority: true, insecureSkipTlsVerify: false })
        .allowed,
    ).toBe(false);
    expect(
      evaluateTlsGate({
        server: "not a url",
        hasCertificateAuthority: true,
        insecureSkipTlsVerify: false,
      }).allowed,
    ).toBe(false);
  });
});

describe("evaluateTlsGate with an explicit skip", () => {
  it("allows a remote https cluster with no CA once skipping was accepted", () => {
    const gate = evaluateTlsGate({
      server: "https://api.prod.example.com:6443",
      hasCertificateAuthority: false,
      insecureSkipTlsVerify: true,
      insecureSkipAccepted: true,
    });
    expect(gate.allowed).toBe(true);
  });

  it("does not let an accepted skip through plain HTTP to a remote host", () => {
    const gate = evaluateTlsGate({
      server: "http://api.prod.example.com:8080",
      hasCertificateAuthority: false,
      insecureSkipTlsVerify: true,
      insecureSkipAccepted: true,
    });
    expect(expectBlocked(gate).reason).toMatch(/plain HTTP/i);
  });
});

describe("kubeconfigTlsYaml", () => {
  const remote = "https://api.prod.example.com:6443";

  it("writes the CA and verifies the server when a CA is given", () => {
    expect(kubeconfigTlsYaml({ server: remote, caData: " LS0t " })).toBe(
      "\n    certificate-authority-data: LS0t",
    );
  });

  it("refuses a remote cluster with no CA and explains why", () => {
    for (const caData of [undefined, null, "", "   "]) {
      expect(() => kubeconfigTlsYaml({ server: remote, caData })).toThrow(TlsBlockedError);
      expect(() => kubeconfigTlsYaml({ server: remote, caData })).toThrow(/CA certificate/i);
    }
  });

  it("allows loopback with no CA and writes no skip flag", () => {
    expect(kubeconfigTlsYaml({ server: "https://127.0.0.1:6443" })).toBe("");
    expect(kubeconfigTlsYaml({ server: "https://localhost:6443", caData: null })).toBe("");
  });

  it("writes the skip flag only when the user asked for it", () => {
    expect(kubeconfigTlsYaml({ server: remote, skipVerification: true })).toBe(
      "\n    insecure-skip-tls-verify: true",
    );
    expect(kubeconfigTlsYaml({ server: "https://127.0.0.1:6443", skipVerification: true })).toBe(
      "\n    insecure-skip-tls-verify: true",
    );
  });

  it("keeps verification on when both a CA and the skip are given", () => {
    expect(kubeconfigTlsYaml({ server: remote, caData: "LS0t", skipVerification: true })).toBe(
      "\n    certificate-authority-data: LS0t",
    );
  });

  it("refuses plain HTTP to a remote host even with a CA or a skip", () => {
    const server = "http://api.prod.example.com:8080";
    expect(() => kubeconfigTlsYaml({ server, caData: "LS0t" })).toThrow(TlsBlockedError);
    expect(() => kubeconfigTlsYaml({ server, skipVerification: true })).toThrow(TlsBlockedError);
  });

  it("refuses a server that is not a URL", () => {
    expect(() => kubeconfigTlsYaml({ server: "not a url", caData: "LS0t" })).toThrow(
      TlsBlockedError,
    );
  });
});
