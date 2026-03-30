import { describe, expect, it } from "vitest";
import { analyzeCredentialSecurity } from "./credential-security";

describe("credential-security", () => {
  it("reports no risk for exec plugin without embedded secrets", () => {
    const report = analyzeCredentialSecurity({
      clusterName: "eks-prod",
      hasEmbeddedToken: false,
      hasEmbeddedCert: false,
      hasEmbeddedKey: false,
      usesExecPlugin: true,
      usesAuthProvider: false,
      insecureSkipTlsVerify: false,
      storedPlaintext: true,
    });

    expect(report.overallRisk).toBe("none");
    expect(report.score).toBe(100);
    expect(report.findings.some((f) => f.title.includes("Dynamic credentials"))).toBe(true);
  });

  it("flags critical risk for insecure-skip-tls-verify", () => {
    const report = analyzeCredentialSecurity({
      clusterName: "dev",
      hasEmbeddedToken: false,
      hasEmbeddedCert: false,
      hasEmbeddedKey: false,
      usesExecPlugin: true,
      usesAuthProvider: false,
      insecureSkipTlsVerify: true,
      storedPlaintext: false,
    });

    expect(report.overallRisk).toBe("critical");
    expect(report.findings.some((f) => f.risk === "critical")).toBe(true);
  });

  it("flags high risk for plaintext bearer token", () => {
    const report = analyzeCredentialSecurity({
      clusterName: "legacy",
      hasEmbeddedToken: true,
      hasEmbeddedCert: false,
      hasEmbeddedKey: false,
      usesExecPlugin: false,
      usesAuthProvider: false,
      insecureSkipTlsVerify: false,
      storedPlaintext: true,
    });

    expect(report.overallRisk).toBe("high");
    expect(report.findings.some((f) => f.title.includes("Bearer token stored in plaintext"))).toBe(
      true,
    );
  });

  it("flags high risk for plaintext private key", () => {
    const report = analyzeCredentialSecurity({
      clusterName: "on-prem",
      hasEmbeddedToken: false,
      hasEmbeddedCert: true,
      hasEmbeddedKey: true,
      usesExecPlugin: false,
      usesAuthProvider: false,
      insecureSkipTlsVerify: false,
      storedPlaintext: true,
    });

    expect(report.overallRisk).toBe("high");
    expect(report.findings.some((f) => f.title.includes("Private key stored in plaintext"))).toBe(
      true,
    );
  });

  it("flags deprecated auth-provider", () => {
    const report = analyzeCredentialSecurity({
      clusterName: "gke-old",
      hasEmbeddedToken: false,
      hasEmbeddedCert: false,
      hasEmbeddedKey: false,
      usesExecPlugin: false,
      usesAuthProvider: true,
      insecureSkipTlsVerify: false,
      storedPlaintext: true,
    });

    expect(report.findings.some((f) => f.title.includes("Deprecated"))).toBe(true);
  });

  it("flags no automatic rotation for static credentials", () => {
    const report = analyzeCredentialSecurity({
      clusterName: "static",
      hasEmbeddedToken: true,
      hasEmbeddedCert: false,
      hasEmbeddedKey: false,
      usesExecPlugin: false,
      usesAuthProvider: false,
      insecureSkipTlsVerify: false,
      storedPlaintext: true,
    });

    expect(report.findings.some((f) => f.title.includes("No automatic credential rotation"))).toBe(
      true,
    );
  });

  it("accumulates score penalties", () => {
    const report = analyzeCredentialSecurity({
      clusterName: "worst-case",
      hasEmbeddedToken: true,
      hasEmbeddedCert: true,
      hasEmbeddedKey: true,
      usesExecPlugin: false,
      usesAuthProvider: true,
      insecureSkipTlsVerify: true,
      storedPlaintext: true,
    });

    expect(report.score).toBeLessThan(30);
    expect(report.overallRisk).toBe("critical");
    expect(report.findings.length).toBeGreaterThanOrEqual(4);
  });
});
