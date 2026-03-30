import { describe, expect, it } from "vitest";
import {
  buildVaultLoginPayload,
  buildVaultSecretReadPayload,
  parseVaultSecretResponse,
} from "./vault-integration";

describe("vault-integration", () => {
  const baseConfig = {
    address: "https://vault.example.com",
    secretPath: "secret/data/k8s/prod",
  };

  describe("buildVaultLoginPayload", () => {
    it("builds token auth request (direct read)", () => {
      const payload = buildVaultLoginPayload({
        ...baseConfig,
        authMethod: "token",
        token: "hvs.my-vault-token",
      });

      expect(payload.method).toBe("GET");
      expect(payload.url).toContain("secret/data/k8s/prod");
      expect(payload.headers["X-Vault-Token"]).toBe("hvs.my-vault-token");
    });

    it("builds kubernetes auth login", () => {
      const payload = buildVaultLoginPayload(
        {
          ...baseConfig,
          authMethod: "kubernetes",
          role: "k8s-reader",
        },
        "eyJhbGciOiJSUzI1NiJ9...",
      );

      expect(payload.method).toBe("POST");
      expect(payload.url).toContain("/auth/kubernetes/login");
      expect(payload.body).toContain("k8s-reader");
    });

    it("builds approle auth login", () => {
      const payload = buildVaultLoginPayload({
        ...baseConfig,
        authMethod: "approle",
        role: "role-id-123",
        token: "secret-id-456",
      });

      expect(payload.url).toContain("/auth/approle/login");
      expect(payload.body).toContain("role-id-123");
      expect(payload.body).toContain("secret-id-456");
    });

    it("includes vault namespace header when set", () => {
      const payload = buildVaultLoginPayload({
        ...baseConfig,
        authMethod: "token",
        token: "t",
        namespace: "platform-team",
      });

      expect(payload.headers["X-Vault-Namespace"]).toBe("platform-team");
    });

    it("uses custom mount path", () => {
      const payload = buildVaultLoginPayload(
        {
          ...baseConfig,
          authMethod: "kubernetes",
          role: "reader",
          mountPath: "k8s-prod",
        },
        "jwt",
      );

      expect(payload.url).toContain("/auth/k8s-prod/login");
    });
  });

  describe("buildVaultSecretReadPayload", () => {
    it("builds secret read request with vault token", () => {
      const payload = buildVaultSecretReadPayload(
        {
          ...baseConfig,
          authMethod: "token",
        },
        "hvs.client-token",
      );

      expect(payload.method).toBe("GET");
      expect(payload.headers["X-Vault-Token"]).toBe("hvs.client-token");
    });
  });

  describe("parseVaultSecretResponse", () => {
    it("parses KV v2 response with kubeconfig", () => {
      const result = parseVaultSecretResponse({
        data: {
          data: { kubeconfig: "apiVersion: v1\nkind: Config..." },
          metadata: { version: 1 },
        },
        lease_duration: 3600,
      });

      expect(result.kubeconfig).toContain("apiVersion");
      expect(result.leaseDuration).toBe(3600);
    });

    it("parses KV v1 response with token", () => {
      const result = parseVaultSecretResponse({
        data: { token: "eyJhbGciOiJSUzI1NiJ9..." },
      });

      expect(result.token).toContain("eyJhbGci");
    });

    it("handles missing fields gracefully", () => {
      const result = parseVaultSecretResponse({ data: {} });
      expect(result.kubeconfig).toBeUndefined();
      expect(result.token).toBeUndefined();
    });
  });
});
