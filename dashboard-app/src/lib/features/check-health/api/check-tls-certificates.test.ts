import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
}));

vi.mock("@/lib/shared/api/kubectl-proxy", () => ({
  kubectlJson: vi.fn(),
  kubectlRawFront: vi.fn(),
  kubectlRawArgsFront: vi.fn(),
}));

import { kubectlJson, kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import {
  TLS_SECRETS_LISTING_ARGS,
  parseTlsSecretListing,
  scanTlsCertificates,
  resetTlsCertCache,
} from "./check-tls-certificates";

const mockedKubectl = vi.mocked(kubectlJson);
const mockedRawArgs = vi.mocked(kubectlRawArgsFront);

/** The TLS secrets listing as kubectl prints it: namespace, name, tls.crt, certificate-name, issuer-name. */
function tlsListing(...rows: string[][]) {
  mockedRawArgs.mockResolvedValueOnce({
    output: rows.map((row) => `${row.join("\t")}\n`).join(""),
    errors: "",
  });
}

describe("check-tls-certificates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTlsCertCache();
  });

  it("returns empty when no TLS secrets and no cert-manager", async () => {
    tlsListing();
    mockedKubectl.mockResolvedValueOnce("the server doesn't have a resource type");

    const result = await scanTlsCertificates("cluster-1", { force: true });

    expect(result.certs).toHaveLength(0);
    expect(result.certManagerAvailable).toBe(false);
    expect(result.errors).toHaveLength(0);
  });

  it("handles TLS secret with cert data", async () => {
    tlsListing(["default", "my-tls", "", "", ""]);
    mockedKubectl.mockResolvedValueOnce("the server doesn't have a resource type");

    const result = await scanTlsCertificates("cluster-1", { force: true });

    expect(result.certs).toHaveLength(1);
    expect(result.certs[0].name).toBe("my-tls");
    expect(result.certs[0].namespace).toBe("default");
    expect(result.certs[0].type).toBe("tls-secret");
    expect(result.certs[0].status).toBe("unknown");
  });

  it("detects cert-manager annotations on TLS secrets", async () => {
    tlsListing(["app", "cm-tls", "", "cm-tls", "letsencrypt"]);
    mockedKubectl.mockResolvedValueOnce("the server doesn't have a resource type");

    const result = await scanTlsCertificates("cluster-1", { force: true });

    expect(result.certs[0].type).toBe("cert-manager");
    expect(result.certs[0].issuer).toBe("letsencrypt");
    expect(result.certs[0].renewAction).toContain("kubectl cert-manager renew");
  });

  it("parses cert-manager Certificate CRDs", async () => {
    tlsListing();
    mockedKubectl.mockResolvedValueOnce({
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
    mockedRawArgs.mockResolvedValueOnce({ output: "", errors: "connection refused" });
    mockedKubectl.mockResolvedValueOnce("connection refused");

    const result = await scanTlsCertificates("cluster-1", { force: true });

    expect(result.certs).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("deduplicates cert-manager certs from TLS secrets", async () => {
    tlsListing(["web", "web-cert", "", "web-cert", ""]);
    mockedKubectl.mockResolvedValueOnce({
      items: [
        {
          metadata: { name: "web-cert", namespace: "web" },
          spec: { dnsNames: ["example.com"], issuerRef: { name: "le" }, secretName: "web-cert" },
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

  it("never asks for whole secrets: no -o json, no tls.key, no full annotations", async () => {
    tlsListing();
    mockedKubectl.mockResolvedValueOnce("the server doesn't have a resource type");

    await scanTlsCertificates("cluster-1", { force: true });

    expect(mockedRawArgs).toHaveBeenCalledWith(TLS_SECRETS_LISTING_ARGS, {
      clusterId: "cluster-1",
    });
    for (const call of mockedKubectl.mock.calls) {
      expect(String(call[0])).not.toMatch(/\bsecrets?\b/);
    }
    const output = TLS_SECRETS_LISTING_ARGS[TLS_SECRETS_LISTING_ARGS.indexOf("-o") + 1];
    expect(output).toMatch(/^jsonpath=/);
    expect(output).not.toContain("tls.key");
    expect(output).not.toContain("tls\\.key");
    expect(output).not.toMatch(/\.metadata\.annotations\}/);
    expect(output).not.toMatch(/\{\.data\}|\{\.items\}|\{@\}/);
  });

  it("reads a record whose annotation holds a tab as managed, without an issuer", () => {
    expect(parseTlsSecretListing("app\tweird\tQUJD\t\ta\tb\tc\n")).toEqual([
      {
        namespace: "app",
        name: "weird",
        certData: "QUJD",
        annotations: { "cert-manager.io/certificate-name": "?" },
      },
    ]);
  });

  it("skips lines that are not a namespace, a name and base64", () => {
    const rows = parseTlsSecretListing(
      ["ok\tplain\tQUJD\t\t", "Bad NS\tx\tQUJD\t\t", "ns\tx\tnot base64!\t\t", "", "short"].join(
        "\n",
      ),
    );
    expect(rows.map((row) => `${row.namespace}/${row.name}`)).toEqual(["ok/plain"]);
  });
});
