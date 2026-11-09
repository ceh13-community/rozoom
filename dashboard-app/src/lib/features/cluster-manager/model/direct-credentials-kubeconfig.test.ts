import { load as parse } from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  generateCertificateKubeconfig,
  generateTokenKubeconfig,
} from "./direct-credentials-kubeconfig";
import { TlsBlockedError } from "./tls-gate";

const remote = "https://api.example.com:6443";
const token = { clusterName: "prod", token: "t0ken" };
const cert = { clusterName: "prod", clientCert: "Y2VydA==", clientKey: "a2V5" };

type ParsedConfig = {
  clusters: Array<{ name: string; cluster: Record<string, unknown> }>;
  users: Array<{ name: string; user: Record<string, unknown> }>;
};

describe.each([
  ["token", (tls: object) => generateTokenKubeconfig({ ...token, ...tls } as never)],
  ["certificate", (tls: object) => generateCertificateKubeconfig({ ...cert, ...tls } as never)],
])("%s kubeconfig TLS", (_name, generate) => {
  it("verifies against the CA when given", () => {
    const config = parse(generate({ serverUrl: remote, caData: "LS0t" })) as ParsedConfig;
    expect(config.clusters[0].cluster).toEqual({
      server: remote,
      "certificate-authority-data": "LS0t",
    });
  });

  it("refuses a remote cluster with no CA", () => {
    expect(() => generate({ serverUrl: remote })).toThrow(TlsBlockedError);
  });

  it("writes no skip flag for loopback with no CA", () => {
    const config = parse(generate({ serverUrl: "https://127.0.0.1:6443" })) as ParsedConfig;
    expect(config.clusters[0].cluster).toEqual({ server: "https://127.0.0.1:6443" });
  });

  it("writes the skip flag only on an explicit request", () => {
    const config = parse(generate({ serverUrl: remote, skipTlsVerify: true })) as ParsedConfig;
    expect(config.clusters[0].cluster["insecure-skip-tls-verify"]).toBe(true);
  });
});

describe("credentials in the generated kubeconfig", () => {
  it("carries the token", () => {
    const config = parse(generateTokenKubeconfig({ ...token, serverUrl: remote, caData: "LS0t" }));
    expect((config as ParsedConfig).users[0].user).toEqual({ token: "t0ken" });
  });

  it("carries the client certificate and key", () => {
    const config = parse(
      generateCertificateKubeconfig({ ...cert, serverUrl: remote, caData: "LS0t" }),
    );
    expect((config as ParsedConfig).users[0].user).toEqual({
      "client-certificate-data": "Y2VydA==",
      "client-key-data": "a2V5",
    });
  });
});
