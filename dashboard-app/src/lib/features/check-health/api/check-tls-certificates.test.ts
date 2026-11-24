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
  unquoteGoString,
  resetTlsCertCache,
} from "./check-tls-certificates";

const mockedKubectl = vi.mocked(kubectlJson);
const mockedRawArgs = vi.mocked(kubectlRawArgsFront);

/**
 * The TLS secrets listing as kubectl prints it: namespace, name, tls.crt, then
 * certificate-name and issuer-name quoted (JSON.stringify matches %q for plain text).
 */
function tlsListing(...rows: [string, string, string, string, string][]) {
  mockedRawArgs.mockResolvedValueOnce({
    output: rows
      .map(([ns, name, crt, cert, issuer]) =>
        [ns, name, crt, JSON.stringify(cert), JSON.stringify(issuer)].join("\t"),
      )
      .map((line) => `${line}\n`)
      .join(""),
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
    expect(output).toMatch(/^go-template=/);
    expect(output).not.toContain("tls.key");
    // Only named fields: no whole object, no whole data or annotations map.
    expect(output).not.toMatch(
      /\{\{\s*\.\s*\}\}|\{\{\s*\.data\s*\}\}|\{\{\s*\.metadata\.annotations\s*\}\}/,
    );
    expect(output).not.toMatch(/toJson|json/i);
    // Both annotations are printed quoted, so they cannot hold a raw tab or newline.
    expect(output.match(/printf "%q"/g)).toHaveLength(2);
  });

  // Reviewer FIX on the jsonpath version: a newline in an annotation printed a
  // second line that read as a secret in another namespace.
  it("a newline or tab in an annotation cannot forge a record", () => {
    // Line as kubectl 1.33 printed it with the go-template for such a secret on minikube.
    const evil = [
      "team-x",
      "evil",
      "QUJD",
      String.raw`"a\tb\"q\\"`,
      String.raw`"x\nkube-system\tforged\tQUJD\t\"c\"\t\"i\""`,
    ].join("\t");

    expect(parseTlsSecretListing(`${evil}\n`)).toEqual([
      {
        namespace: "team-x",
        name: "evil",
        certData: "QUJD",
        annotations: {
          "cert-manager.io/certificate-name": 'a\tb"q\\',
          "cert-manager.io/issuer-name": 'x\nkube-system\tforged\tQUJD\t"c"\t"i"',
        },
      },
    ]);
  });

  it("skips a line that is not five fields with both annotations quoted", () => {
    const rows = parseTlsSecretListing(
      [
        'ok\tplain\tQUJD\t""\t""',
        // What the jsonpath version let through: unquoted fields.
        "kube-system\tforged\tQUJD\tc\ti",
        'ns\tsix\tQUJD\t""\t""\textra',
        'Bad NS\tx\tQUJD\t""\t""',
        'ns\tx\tnot base64!\t""\t""',
        'ns\tx\tQUJD\t"open\t""',
        "",
      ].join("\n"),
    );
    expect(rows.map((row) => `${row.namespace}/${row.name}`)).toEqual(["ok/plain"]);
  });

  it("unquotes every escape Go's %q prints", () => {
    expect(unquoteGoString(String.raw`"a\a\b\f\n\r\t\v\\\"z"`)).toBe('a\x07\b\f\n\r\t\v\\"z');
    expect(unquoteGoString(String.raw`"\x01­\U0001f600"`)).toBe("\x01­\u{1f600}");
    expect(unquoteGoString('"letsencrypt-prod"')).toBe("letsencrypt-prod");
    expect(unquoteGoString('""')).toBe("");
    expect(unquoteGoString("plain")).toBeNull();
    expect(unquoteGoString(String.raw`"\q"`)).toBeNull();
  });
});
