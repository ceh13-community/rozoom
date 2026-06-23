import { describe, expect, it } from "vitest";
import { evaluateTlsGate } from "./tls-gate";

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
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/insecure-skip-tls-verify|verification/i);
  });

  it("blocks a remote https cluster with no CA", () => {
    const gate = evaluateTlsGate({
      server: "https://api.prod.example.com:6443",
      hasCertificateAuthority: false,
      insecureSkipTlsVerify: false,
    });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/CA certificate/i);
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
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/http|HTTPS/i);
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
