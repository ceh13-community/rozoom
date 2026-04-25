import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
}));

vi.mock("@/lib/shared/api/kubectl-proxy", () => ({
  kubectlJson: vi.fn(),
  kubectlRawFront: vi.fn(),
}));

import { kubectlJson } from "$shared/api/kubectl-proxy";
import { scanTlsCertificates, resetTlsCertCache } from "./check-tls-certificates";

const mockedKubectl = vi.mocked(kubectlJson);

describe("check-tls-certificates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTlsCertCache();
  });

  it("returns empty when no TLS secrets and no cert-manager", async () => {
    mockedKubectl
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce("the server doesn't have a resource type");

    const result = await scanTlsCertificates("cluster-1", { force: true });

    expect(result.certs).toHaveLength(0);
    expect(result.certManagerAvailable).toBe(false);
    expect(result.errors).toHaveLength(0);
  });

  it("handles TLS secret with cert data", async () => {
    mockedKubectl
      .mockResolvedValueOnce({
        items: [
          {
            metadata: { name: "my-tls", namespace: "default" },
            data: { "tls.crt": "" },
          },
        ],
      })
      .mockResolvedValueOnce("the server doesn't have a resource type");

    const result = await scanTlsCertificates("cluster-1", { force: true });

    expect(result.certs).toHaveLength(1);
    expect(result.certs[0].name).toBe("my-tls");
    expect(result.certs[0].namespace).toBe("default");
    expect(result.certs[0].type).toBe("tls-secret");
    expect(result.certs[0].status).toBe("unknown");
  });

  it("detects cert-manager annotations on TLS secrets", async () => {
    mockedKubectl
      .mockResolvedValueOnce({
        items: [
          {
            metadata: {
              name: "cm-tls",
              namespace: "app",
              annotations: {
                "cert-manager.io/issuer-name": "letsencrypt",
                "cert-manager.io/certificate-name": "cm-tls",
              },
            },
            data: { "tls.crt": "" },
          },
        ],
      })
      .mockResolvedValueOnce("the server doesn't have a resource type");

    const result = await scanTlsCertificates("cluster-1", { force: true });

    expect(result.certs[0].type).toBe("cert-manager");
    expect(result.certs[0].issuer).toBe("letsencrypt");
    expect(result.certs[0].renewAction).toContain("kubectl cert-manager renew");
  });

  it("parses cert-manager Certificate CRDs", async () => {
    mockedKubectl.mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({
      items: [
        {
          metadata: { name: "web-cert", namespace: "web" },
          spec: {
            dnsNames: ["example.com", "www.example.com"],
            issuerRef: { name: "letsencrypt-prod", kind: "ClusterIssuer" },
          },
          status: {
            notAfter: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
            conditions: [{ type: "Ready", status: "True" }],
          },
        },
      ],
    });

    const result = await scanTlsCertificates("cluster-1", { force: true });

    expect(result.certManagerAvailable).toBe(true);
    expect(result.certs).toHaveLength(1);
    expect(result.certs[0].name).toBe("web-cert");
    expect(result.certs[0].dnsNames).toEqual(["example.com", "www.example.com"]);
    expect(result.certs[0].issuer).toBe("letsencrypt-prod");
    expect(result.certs[0].daysLeft).toBeGreaterThan(0);
    expect(result.certs[0].status).toBe("warning");
  });

  it("handles kubectl errors gracefully", async () => {
    mockedKubectl
      .mockResolvedValueOnce("connection refused")
      .mockResolvedValueOnce("connection refused");

    const result = await scanTlsCertificates("cluster-1", { force: true });

    expect(result.certs).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("deduplicates cert-manager certs from TLS secrets", async () => {
    mockedKubectl
      .mockResolvedValueOnce({
        items: [
          {
            metadata: {
              name: "web-cert",
              namespace: "web",
              annotations: { "cert-manager.io/certificate-name": "web-cert" },
            },
            data: { "tls.crt": "" },
          },
        ],
      })
      .mockResolvedValueOnce({
        items: [
          {
            metadata: { name: "web-cert", namespace: "web" },
            spec: { dnsNames: ["example.com"], issuerRef: { name: "le" } },
            status: {
              notAfter: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
              conditions: [{ type: "Ready", status: "True" }],
            },
          },
        ],
      });

    const result = await scanTlsCertificates("cluster-1", { force: true });

    expect(result.certs).toHaveLength(1);
    expect(result.certs[0].type).toBe("cert-manager");
  });
});
