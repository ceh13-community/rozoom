import { describe, expect, it } from "vitest";
import { detectAuthMethod, buildAuthReport } from "./auth-detection";

describe("auth-detection", () => {
  describe("detectAuthMethod", () => {
    it("detects exec plugin (aws)", () => {
      const result = detectAuthMethod({ execCommand: "aws" });
      expect(result.method).toBe("exec-plugin");
      expect(result.securityLevel).toBe("high");
      expect(result.label).toContain("AWS");
    });

    it("detects exec plugin (gke-gcloud-auth-plugin)", () => {
      const result = detectAuthMethod({
        execCommand: "/usr/lib/google-cloud-sdk/bin/gke-gcloud-auth-plugin",
      });
      expect(result.method).toBe("exec-plugin");
      expect(result.execPlugin).toBe("gke-gcloud-auth-plugin");
    });

    it("detects OIDC via kubelogin exec", () => {
      const result = detectAuthMethod({ execCommand: "kubelogin" });
      expect(result.method).toBe("oidc");
      expect(result.securityLevel).toBe("high");
    });

    it("detects OIDC via kubectl-oidc_login", () => {
      const result = detectAuthMethod({ execCommand: "/usr/local/bin/kubectl-oidc_login" });
      expect(result.method).toBe("oidc");
    });

    it("detects x509 client certificate", () => {
      const result = detectAuthMethod({ hasCertAuth: true });
      expect(result.method).toBe("x509-certificate");
      expect(result.securityLevel).toBe("high");
      expect(result.warnings).toHaveLength(0);
    });

    it("detects bearer token (static, no expiry)", () => {
      const result = detectAuthMethod({ hasToken: true, token: "some-opaque-token" });
      expect(result.method).toBe("bearer-token");
      expect(result.securityLevel).toBe("low");
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes("Static bearer token"))).toBe(true);
    });

    it("detects bearer token with JWT expiry", () => {
      // Create a JWT that expires in 2 hours
      const payload = { exp: Math.floor(Date.now() / 1000) + 7200 };
      const jwt = `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify(payload))}.signature`;
      const result = detectAuthMethod({ hasToken: true, token: jwt });
      expect(result.method).toBe("bearer-token");
      expect(result.securityLevel).toBe("medium");
      expect(result.tokenExpiry).toBeDefined();
      expect(result.tokenExpired).toBe(false);
      expect(result.tokenExpiresInHours).toBeGreaterThan(0);
    });

    it("detects expired JWT token", () => {
      const payload = { exp: Math.floor(Date.now() / 1000) - 3600 };
      const jwt = `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify(payload))}.signature`;
      const result = detectAuthMethod({ hasToken: true, token: jwt });
      expect(result.tokenExpired).toBe(true);
      expect(result.warnings.some((w) => w.includes("expired"))).toBe(true);
    });

    it("warns about deprecated auth-provider", () => {
      const result = detectAuthMethod({ authProvider: "gcp" });
      expect(result.method).toBe("auth-provider");
      expect(result.securityLevel).toBe("medium");
      expect(result.warnings.some((w) => w.includes("deprecated"))).toBe(true);
      expect(result.recommendations.some((r) => r.includes("exec plugin"))).toBe(true);
    });

    it("returns unknown for empty user", () => {
      const result = detectAuthMethod({});
      expect(result.method).toBe("unknown");
      expect(result.securityLevel).toBe("unknown");
    });

    it("exec plugin takes priority over certificate", () => {
      const result = detectAuthMethod({ execCommand: "aws", hasCertAuth: true, hasToken: true });
      expect(result.method).toBe("exec-plugin");
    });
  });

  describe("buildAuthReport", () => {
    it("builds summary across clusters", () => {
      const report = buildAuthReport([
        { name: "eks-prod", uuid: "u1", user: { execCommand: "aws" } },
        { name: "gke-staging", uuid: "u2", user: { authProvider: "gcp" } },
        { name: "local", uuid: "u3", user: { hasCertAuth: true } },
        { name: "legacy", uuid: "u4", user: { hasToken: true, token: "static-token" } },
      ]);

      expect(report.clusters).toHaveLength(4);
      expect(report.summary.total).toBe(4);
      expect(report.summary.highSecurity).toBe(2);
      expect(report.summary.mediumSecurity).toBe(1);
      expect(report.summary.lowSecurity).toBe(1);
      expect(report.summary.deprecatedAuthProviders).toBe(1);
    });
  });
});
