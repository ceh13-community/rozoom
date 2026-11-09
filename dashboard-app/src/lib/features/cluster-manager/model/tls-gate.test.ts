import { describe, expect, it } from "vitest";
import {
  assertClusterName,
  assertKubeconfigValues,
  evaluateTlsGate,
  kubeconfigTlsYaml,
  TlsBlockedError,
  type TlsGateResult,
  yamlQuoted,
} from "./tls-gate";

const LINE_BREAKS = [
  ["NEL", "\u0085"],
  ["LS", "\u2028"],
  ["PS", "\u2029"],
  ["LF", "\n"],
] as const;
const smuggle = (value: string, br: string) =>
  `${value}${br}    insecure-skip-tls-verify:${br}      true`;

/** Assert the gate blocked and narrow to the blocking variant so `reason` is typed. */
function expectBlocked(gate: TlsGateResult): { allowed: false; reason: string } {
  expect(gate.allowed).toBe(false);
  if (gate.allowed) throw new Error("expected TLS gate to block the connection");
  return gate;
}

describe("evaluateTlsGate", () => {
  it("allows a remote https cluster that has a CA", () => {
    const gate = evaluateTlsGate({
      server: "https://api.prod.example.com:6443",
      hasCertificateAuthority: true,
      insecureSkipTlsVerify: false,
    });
    expect(gate.allowed).toBe(true);
  });

  it("blocks insecure-skip-tls-verify regardless of CA", () => {
    const gate = evaluateTlsGate({
      server: "https://api.prod.example.com:6443",
      hasCertificateAuthority: true,
      insecureSkipTlsVerify: true,
    });
    expect(expectBlocked(gate).reason).toMatch(/insecure-skip-tls-verify|verification/i);
  });

  it("blocks a remote https cluster with no CA", () => {
    const gate = evaluateTlsGate({
      server: "https://api.prod.example.com:6443",
      hasCertificateAuthority: false,
      insecureSkipTlsVerify: false,
    });
    expect(expectBlocked(gate).reason).toMatch(/CA certificate/i);
  });

  it("allows a loopback cluster without a CA (local dev)", () => {
    for (const server of [
      "https://localhost:6443",
      "https://127.0.0.1:6443",
      "https://[::1]:6443",
    ]) {
      const gate = evaluateTlsGate({
        server,
        hasCertificateAuthority: false,
        insecureSkipTlsVerify: false,
      });
      expect(gate.allowed, server).toBe(true);
    }
  });

  it("still blocks insecure-skip-tls-verify even on loopback", () => {
    const gate = evaluateTlsGate({
      server: "https://127.0.0.1:6443",
      hasCertificateAuthority: false,
      insecureSkipTlsVerify: true,
    });
    expect(gate.allowed).toBe(false);
  });

  it("blocks a remote cluster served over plain http", () => {
    const gate = evaluateTlsGate({
      server: "http://api.prod.example.com:8080",
      hasCertificateAuthority: false,
      insecureSkipTlsVerify: false,
    });
    expect(expectBlocked(gate).reason).toMatch(/http|HTTPS/i);
  });

  it("blocks when the server URL is missing or unparseable", () => {
    expect(
      evaluateTlsGate({ server: "", hasCertificateAuthority: true, insecureSkipTlsVerify: false })
        .allowed,
    ).toBe(false);
    expect(
      evaluateTlsGate({
        server: "not a url",
        hasCertificateAuthority: true,
        insecureSkipTlsVerify: false,
      }).allowed,
    ).toBe(false);
  });
});

describe("evaluateTlsGate with an explicit skip", () => {
  it("allows a remote https cluster with no CA once skipping was accepted", () => {
    const gate = evaluateTlsGate({
      server: "https://api.prod.example.com:6443",
      hasCertificateAuthority: false,
      insecureSkipTlsVerify: true,
      insecureSkipAccepted: true,
    });
    expect(gate.allowed).toBe(true);
  });

  it("does not let an accepted skip through plain HTTP to a remote host", () => {
    const gate = evaluateTlsGate({
      server: "http://api.prod.example.com:8080",
      hasCertificateAuthority: false,
      insecureSkipTlsVerify: true,
      insecureSkipAccepted: true,
    });
    expect(expectBlocked(gate).reason).toMatch(/plain HTTP/i);
  });
});

describe("kubeconfigTlsYaml", () => {
  const remote = "https://api.prod.example.com:6443";

  it("writes the CA and verifies the server when a CA is given", () => {
    expect(kubeconfigTlsYaml({ server: remote, caData: " LS0t " })).toBe(
      "\n    certificate-authority-data: LS0t",
    );
  });

  it("refuses a remote cluster with no CA and explains why", () => {
    for (const caData of [undefined, null, "", "   "]) {
      expect(() => kubeconfigTlsYaml({ server: remote, caData })).toThrow(TlsBlockedError);
      expect(() => kubeconfigTlsYaml({ server: remote, caData })).toThrow(/CA certificate/i);
    }
  });

  it("allows loopback with no CA and writes no skip flag", () => {
    expect(kubeconfigTlsYaml({ server: "https://127.0.0.1:6443" })).toBe("");
    expect(kubeconfigTlsYaml({ server: "https://localhost:6443", caData: null })).toBe("");
  });

  it("writes the skip flag only when the user asked for it", () => {
    expect(kubeconfigTlsYaml({ server: remote, skipVerification: true })).toBe(
      "\n    insecure-skip-tls-verify: true",
    );
    expect(kubeconfigTlsYaml({ server: "https://127.0.0.1:6443", skipVerification: true })).toBe(
      "\n    insecure-skip-tls-verify: true",
    );
  });

  it("keeps verification on when both a CA and the skip are given", () => {
    expect(kubeconfigTlsYaml({ server: remote, caData: "LS0t", skipVerification: true })).toBe(
      "\n    certificate-authority-data: LS0t",
    );
  });

  it("refuses plain HTTP to a remote host even with a CA or a skip", () => {
    const server = "http://api.prod.example.com:8080";
    expect(() => kubeconfigTlsYaml({ server, caData: "LS0t" })).toThrow(TlsBlockedError);
    expect(() => kubeconfigTlsYaml({ server, skipVerification: true })).toThrow(TlsBlockedError);
  });

  it("refuses a server that is not a URL", () => {
    expect(() => kubeconfigTlsYaml({ server: "not a url", caData: "LS0t" })).toThrow(
      TlsBlockedError,
    );
  });
});

describe.each(LINE_BREAKS)("a %s in a kubeconfig value", (_name, br) => {
  const remote = "https://api.prod.example.com:6443";

  it("is refused in the server URL, also where the URL parser would accept it", () => {
    expect(() =>
      kubeconfigTlsYaml({ server: smuggle(`${remote}/k8s`, br), caData: "LS0t" }),
    ).toThrow(/API server URL/);
  });

  it("is refused in the CA", () => {
    expect(() => kubeconfigTlsYaml({ server: remote, caData: smuggle("LS0t", br) })).toThrow(
      TlsBlockedError,
    );
  });

  it("is refused by the field check, which names the field and not the value", () => {
    expect(() => assertKubeconfigValues({ Token: `s3cret${br}x` })).toThrow(/^Token .*U\+/);
    expect(() => assertKubeconfigValues({ Token: `s3cret${br}x` })).not.toThrow(/s3cret/);
  });

  it("is written only as an escape inside a quoted value", () => {
    const quoted = yamlQuoted(`a${br}b`);
    expect(quoted).toMatch(/^"a\\[nu][0-9a-f]*b"$/);
    expect(quoted).not.toContain(br);
  });
});

describe("assertClusterName", () => {
  it.each(["prod", "prod east", "мій кластер", "кластер 🚀"])("allows %s", (name) => {
    expect(() => assertClusterName(name)).not.toThrow();
  });

  it.each([
    ["NEL", "\u0085"],
    ["LS", "\u2028"],
    ["PS", "\u2029"],
    ["LF", "\n"],
    ["CR", "\r"],
    ["TAB", "\t"],
    ["NUL", "\u0000"],
    ["DEL", "\u007f"],
  ])("refuses %s, and names it", (_name, char) => {
    const code = char.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0");
    expect(() => assertClusterName(`a${char}b`)).toThrow(TlsBlockedError);
    expect(() => assertClusterName(`a${char}b`)).toThrow(`U+${code}`);
  });
});

describe("yamlQuoted outside ASCII", () => {
  it("keeps an emoji as UTF-8, because kubectl cannot read surrogate escapes", () => {
    expect(yamlQuoted("a🚀b")).toBe('"a🚀b"');
  });

  it.each([
    ["DEL", "\u007f", "\\u007f"],
    ["Cyrillic", "я", "\\u044f"],
    ["BOM", "\ufeff", "\\ufeff"],
    ["last BMP code point", "\uffff", "\\uffff"],
  ])("escapes %s", (_name, char, escaped) => {
    expect(yamlQuoted(char)).toBe(`"${escaped}"`);
  });
});

describe("kubeconfigTlsYaml CA encoding", () => {
  const server = "https://api.prod.example.com:6443";

  it.each([
    ["raw PEM", "-----BEGIN CERTIFICATE-----"],
    ["inner space", "LS0t LS0t"],
    ["bad padding", "LS0tL"],
    ["padding in the middle", "LS==LS0t"],
  ])("refuses %s", (_name, caData) => {
    expect(() => kubeconfigTlsYaml({ server, caData })).toThrow(/base64/);
  });
});
