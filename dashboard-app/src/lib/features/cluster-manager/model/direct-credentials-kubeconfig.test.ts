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

const LINE_BREAKS = [
  ["NEL", "\u0085"],
  ["LS", "\u2028"],
  ["PS", "\u2029"],
  ["LF", "\n"],
] as const;
const smuggle = (value: string, br: string) =>
  `${value}${br}    insecure-skip-tls-verify:${br}      true`;

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

describe.each(LINE_BREAKS)("a %s smuggled into a credential form field", (_name, br) => {
  const clean = { serverUrl: `${remote}/k8s`, caData: "LS0t" };

  it.each(["clusterName", "serverUrl", "token"] as const)("is refused in %s", (field) => {
    const input = { ...token, ...clean };
    expect(() => generateTokenKubeconfig({ ...input, [field]: smuggle(input[field], br) })).toThrow(
      TlsBlockedError,
    );
  });

  it.each(["clusterName", "serverUrl", "clientCert", "clientKey"] as const)(
    "is refused in %s",
    (field) => {
      const input = { ...cert, ...clean };
      expect(() =>
        generateCertificateKubeconfig({ ...input, [field]: smuggle(input[field], br) }),
      ).toThrow(TlsBlockedError);
    },
  );
});

describe("a pasted line break in the token textarea", () => {
  it("cannot add an exec block that would run a command", () => {
    expect(() =>
      generateTokenKubeconfig({
        ...token,
        serverUrl: remote,
        caData: "LS0t",
        token: "t0ken\n    exec:\n      command: /tmp/evil",
      }),
    ).toThrow(TlsBlockedError);
  });
});
