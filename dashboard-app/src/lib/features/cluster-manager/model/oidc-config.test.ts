import { describe, expect, it } from "vitest";
import { generateKubeloginExecConfig, generateOidcKubeconfig, OIDC_PRESETS } from "./oidc-config";

describe("oidc-config", () => {
  it("has presets for all major providers", () => {
    expect(OIDC_PRESETS.length).toBeGreaterThanOrEqual(5);
    const providers = OIDC_PRESETS.map((p) => p.provider);
    expect(providers).toContain("azure-ad");
    expect(providers).toContain("okta");
    expect(providers).toContain("keycloak");
    expect(providers).toContain("google");
    expect(providers).toContain("generic");
  });

  describe("generateKubeloginExecConfig", () => {
    it("generates exec config for Azure AD", () => {
      const exec = generateKubeloginExecConfig({
        provider: "azure-ad",
        issuerUrl: "https://login.microsoftonline.com/tenant-123/v2.0",
        clientId: "my-client-id",
      });

      expect(exec.command).toBe("kubelogin");
      expect(exec.args).toContain("get-token");
      expect(exec.args).toContain(
        "--oidc-issuer-url=https://login.microsoftonline.com/tenant-123/v2.0",
      );
      expect(exec.args).toContain("--oidc-client-id=my-client-id");
    });

    it("includes client secret when provided", () => {
      const exec = generateKubeloginExecConfig({
        provider: "generic",
        issuerUrl: "https://sso.example.com",
        clientId: "client",
        clientSecret: "secret-123",
      });

      expect(exec.args).toContain("--oidc-client-secret=secret-123");
    });

    it("adds default scopes from preset", () => {
      const exec = generateKubeloginExecConfig({
        provider: "okta",
        issuerUrl: "https://myorg.okta.com",
        clientId: "client",
      });

      expect(exec.args.some((a) => a.includes("--oidc-extra-scope=openid"))).toBe(true);
      expect(exec.args.some((a) => a.includes("--oidc-extra-scope=groups"))).toBe(true);
    });

    it("uses gke-gcloud-auth-plugin for Google", () => {
      const exec = generateKubeloginExecConfig({
        provider: "google",
        issuerUrl: "https://accounts.google.com",
        clientId: "gke-client",
      });

      expect(exec.command).toBe("gke-gcloud-auth-plugin");
    });
  });

  describe("generateOidcKubeconfig", () => {
    it("generates complete kubeconfig with OIDC exec", () => {
      const yaml = generateOidcKubeconfig(
        "prod-cluster",
        "https://k8s.example.com:6443",
        "LS0tLS1CRUdJTi...",
        { provider: "generic", issuerUrl: "https://sso.example.com", clientId: "k8s" },
      );

      expect(yaml).toContain("kind: Config");
      expect(yaml).toContain("server: https://k8s.example.com:6443");
      expect(yaml).toContain("certificate-authority-data: LS0tLS1CRUdJTi...");
      expect(yaml).toContain("command: kubelogin");
      expect(yaml).toContain("get-token");
      expect(yaml).toContain("--oidc-issuer-url=https://sso.example.com");
    });

    it("uses insecure-skip-tls when no CA data", () => {
      const yaml = generateOidcKubeconfig("dev", "https://localhost:6443", null, {
        provider: "generic",
        issuerUrl: "https://sso.dev",
        clientId: "dev",
      });

      expect(yaml).toContain("insecure-skip-tls-verify: true");
      expect(yaml).not.toContain("certificate-authority-data");
    });
  });
});
