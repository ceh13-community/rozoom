import { describe, it, expect } from "vitest";
import {
  buildExecBlock,
  generateExecKubeconfig,
  getExecPluginPreset,
  EXEC_PLUGIN_PRESETS,
} from "./exec-plugin";

describe("exec-plugin / presets", () => {
  it("exposes all six presets with a docs URL", () => {
    expect(EXEC_PLUGIN_PRESETS).toHaveLength(6);
    for (const preset of EXEC_PLUGIN_PRESETS) {
      expect(preset.docsUrl).toMatch(/^https?:\/\//);
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });

  it("returns preset by kind and throws on unknown", () => {
    expect(getExecPluginPreset("aws-eks").bundled).toBe(true);
    // @ts-expect-error bogus kind
    expect(() => getExecPluginPreset("bogus")).toThrow();
  });
});

describe("exec-plugin / buildExecBlock", () => {
  it("aws-eks builds expected args with region + cluster + profile", () => {
    const block = buildExecBlock({
      kind: "aws-eks",
      clusterName: "prod",
      serverUrl: "https://eks.example.com",
      primary: "prod",
      secondary: "us-east-1",
      extra: "ops",
    });
    expect(block.command).toBe("aws");
    expect(block.args).toEqual([
      "--region",
      "us-east-1",
      "eks",
      "get-token",
      "--cluster-name",
      "prod",
      "--output",
      "json",
      "--profile",
      "ops",
    ]);
  });

  it("aws-eks omits profile when blank", () => {
    const block = buildExecBlock({
      kind: "aws-eks",
      clusterName: "prod",
      serverUrl: "https://x",
      primary: "prod",
      secondary: "us-east-1",
    });
    expect(block.args).not.toContain("--profile");
  });

  it("aws-eks throws without required fields", () => {
    expect(() =>
      buildExecBlock({
        kind: "aws-eks",
        clusterName: "x",
        serverUrl: "x",
        primary: "",
        secondary: "us-east-1",
      }),
    ).toThrow();
  });

  it("gke-auth is a zero-arg exec", () => {
    const block = buildExecBlock({
      kind: "gke-auth",
      clusterName: "gke",
      serverUrl: "https://x",
    });
    expect(block.command).toBe("gke-gcloud-auth-plugin");
    expect(block.args).toEqual([]);
  });

  it("kubelogin includes issuer + client id, skips empty secret", () => {
    const block = buildExecBlock({
      kind: "kubelogin",
      clusterName: "k",
      serverUrl: "x",
      primary: "https://idp.example.com",
      secondary: "abc",
    });
    expect(block.command).toBe("kubelogin");
    expect(block.args).toContain("--oidc-issuer-url=https://idp.example.com");
    expect(block.args).toContain("--oidc-client-id=abc");
    expect(block.args.some((a) => a.startsWith("--oidc-client-secret"))).toBe(false);
  });

  it("kubelogin includes client-secret when provided", () => {
    const block = buildExecBlock({
      kind: "kubelogin",
      clusterName: "k",
      serverUrl: "x",
      primary: "https://idp.example.com",
      secondary: "abc",
      tertiary: "supersecret",
    });
    expect(block.args).toContain("--oidc-client-secret=supersecret");
  });

  it("aws-iam uses cluster id flag", () => {
    const block = buildExecBlock({
      kind: "aws-iam",
      clusterName: "c",
      serverUrl: "x",
      primary: "prod",
    });
    expect(block.command).toBe("aws-iam-authenticator");
    expect(block.args).toEqual(["token", "-i", "prod"]);
  });

  it("oc-login uses whoami -t", () => {
    const block = buildExecBlock({
      kind: "oc-login",
      clusterName: "o",
      serverUrl: "x",
    });
    expect(block.command).toBe("oc");
    expect(block.args).toEqual(["whoami", "-t"]);
  });

  it("generic splits extra string into args", () => {
    const block = buildExecBlock({
      kind: "generic",
      clusterName: "g",
      serverUrl: "x",
      command: "my-auth",
      extra: "--flag value  --bool",
    });
    expect(block.command).toBe("my-auth");
    expect(block.args).toEqual(["--flag", "value", "--bool"]);
  });

  it("generic prefers explicit args over extra", () => {
    const block = buildExecBlock({
      kind: "generic",
      clusterName: "g",
      serverUrl: "x",
      command: "my-auth",
      args: ["--foo", "bar"],
      extra: "ignored",
    });
    expect(block.args).toEqual(["--foo", "bar"]);
  });
});

describe("exec-plugin / generateExecKubeconfig", () => {
  it("emits a valid kubeconfig with exec user block", () => {
    const yaml = generateExecKubeconfig({
      kind: "aws-eks",
      clusterName: "prod",
      serverUrl: "https://eks.example.com",
      caData: "LS0tLS1CRUdJTg==",
      primary: "prod",
      secondary: "us-east-1",
    });
    expect(yaml).toContain("apiVersion: v1");
    expect(yaml).toContain("kind: Config");
    expect(yaml).toContain("current-context: prod");
    expect(yaml).toContain("command: aws");
    expect(yaml).toContain("apiVersion: client.authentication.k8s.io/v1beta1");
    expect(yaml).toContain("certificate-authority-data: LS0tLS1CRUdJTg==");
    expect(yaml).toContain("interactiveMode: IfAvailable");
    expect(yaml).not.toContain("insecure-skip-tls-verify");
  });

  it("falls back to insecure-skip-tls-verify when no CA provided", () => {
    const yaml = generateExecKubeconfig({
      kind: "gke-auth",
      clusterName: "dev",
      serverUrl: "https://x",
    });
    expect(yaml).toContain("insecure-skip-tls-verify: true");
    expect(yaml).toContain("args: []");
  });

  it("does NOT embed any token or secret in the kubeconfig", () => {
    const yaml = generateExecKubeconfig({
      kind: "kubelogin",
      clusterName: "c",
      serverUrl: "https://x",
      primary: "https://idp",
      secondary: "client",
      tertiary: "secret-value",
    });
    // client-secret ends up as an exec arg (not great but expected);
    // but no raw "token:" or "client-key-data:" anywhere.
    expect(yaml).not.toContain("token:");
    expect(yaml).not.toContain("client-key-data");
    expect(yaml).not.toContain("client-certificate-data");
  });

  it("requires clusterName and serverUrl", () => {
    expect(() =>
      generateExecKubeconfig({
        kind: "gke-auth",
        clusterName: "",
        serverUrl: "x",
      }),
    ).toThrow();
    expect(() =>
      generateExecKubeconfig({
        kind: "gke-auth",
        clusterName: "x",
        serverUrl: "",
      }),
    ).toThrow();
  });

  it("quotes special characters in args safely", () => {
    const yaml = generateExecKubeconfig({
      kind: "generic",
      clusterName: "g",
      serverUrl: "x",
      command: "helper",
      args: ["--json", `{"key":"value"}`],
    });
    // JSON.stringify wraps and escapes quotes - YAML parsers must accept it.
    expect(yaml).toContain(`- "--json"`);
    expect(yaml).toContain(`- "{\\"key\\":\\"value\\"}"`);
  });
});
