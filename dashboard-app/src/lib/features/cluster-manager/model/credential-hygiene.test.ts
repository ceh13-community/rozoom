import { describe, expect, it } from "vitest";
import { runCredentialHygiene } from "./credential-hygiene";

const base = {
  clusterId: "u1",
  clusterName: "test",
  hasEmbeddedToken: false,
  hasEmbeddedClientKey: false,
  hasEmbeddedClientCert: false,
  insecureSkipTlsVerify: false,
  usesExecPlugin: false,
  configFileExists: true,
};

describe("credential-hygiene", () => {
  it("passes all checks for exec plugin with proper permissions", () => {
    const report = runCredentialHygiene({
      ...base,
      usesExecPlugin: true,
      filePermissions: "600",
    });

    expect(report.failCount).toBe(0);
    expect(report.warnCount).toBe(0);
    expect(report.passCount).toBeGreaterThanOrEqual(3);
  });

  it("fails for missing config file", () => {
    const report = runCredentialHygiene({
      ...base,
      configFileExists: false,
    });

    expect(report.checks.find((c) => c.id === "config-exists")?.status).toBe("fail");
  });

  it("fails for world-readable file permissions", () => {
    const report = runCredentialHygiene({
      ...base,
      filePermissions: "644",
    });

    expect(report.checks.find((c) => c.id === "file-permissions")?.status).toBe("fail");
    expect(report.checks.find((c) => c.id === "file-permissions")?.remediation).toContain(
      "chmod 600",
    );
  });

  it("passes for 600 permissions", () => {
    const report = runCredentialHygiene({
      ...base,
      filePermissions: "600",
    });

    expect(report.checks.find((c) => c.id === "file-permissions")?.status).toBe("pass");
  });

  it("passes for 400 (read-only) permissions", () => {
    const report = runCredentialHygiene({
      ...base,
      filePermissions: "400",
    });

    expect(report.checks.find((c) => c.id === "file-permissions")?.status).toBe("pass");
  });

  it("fails for insecure-skip-tls-verify", () => {
    const report = runCredentialHygiene({
      ...base,
      insecureSkipTlsVerify: true,
    });

    expect(report.checks.find((c) => c.id === "tls-verify")?.status).toBe("fail");
    expect(report.checks.find((c) => c.id === "tls-verify")?.detail).toContain("MITM");
  });

  it("warns for static bearer token", () => {
    const report = runCredentialHygiene({
      ...base,
      hasEmbeddedToken: true,
    });

    expect(report.checks.find((c) => c.id === "credential-type")?.status).toBe("warn");
  });

  it("warns for embedded private key", () => {
    const report = runCredentialHygiene({
      ...base,
      hasEmbeddedClientKey: true,
    });

    expect(report.checks.find((c) => c.id === "embedded-key")?.status).toBe("warn");
  });

  it("fails for expired token", () => {
    const report = runCredentialHygiene({
      ...base,
      hasEmbeddedToken: true,
      tokenExpired: true,
    });

    expect(report.checks.find((c) => c.id === "token-expiry")?.status).toBe("fail");
  });

  it("warns for token expiring within 24h", () => {
    const report = runCredentialHygiene({
      ...base,
      hasEmbeddedToken: true,
      tokenExpiresInHours: 12,
    });

    expect(report.checks.find((c) => c.id === "token-expiry")?.status).toBe("warn");
  });

  it("passes for token with long validity", () => {
    const report = runCredentialHygiene({
      ...base,
      hasEmbeddedToken: true,
      tokenExpiresInHours: 720,
    });

    expect(report.checks.find((c) => c.id === "token-expiry")?.status).toBe("pass");
  });

  it("accumulates worst-case scenario", () => {
    const report = runCredentialHygiene({
      clusterId: "u1",
      clusterName: "worst",
      hasEmbeddedToken: true,
      hasEmbeddedClientKey: true,
      hasEmbeddedClientCert: true,
      insecureSkipTlsVerify: true,
      usesExecPlugin: false,
      configFileExists: true,
      filePermissions: "644",
      tokenExpired: true,
    });

    expect(report.failCount).toBeGreaterThanOrEqual(3);
    expect(report.warnCount).toBeGreaterThanOrEqual(2);
  });
});
