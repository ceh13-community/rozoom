import { load as parse } from "js-yaml";
import { describe, expect, it } from "vitest";
import { generateKubeloginExecConfig, generateOidcKubeconfig, OIDC_PRESETS } from "./oidc-config";
import { TlsBlockedError } from "./tls-gate";

const LINE_BREAKS = [
  ["NEL", "\u0085"],
  ["LS", "\u2028"],
  ["PS", "\u2029"],
  ["LF", "\n"],
] as const;
const smuggle = (value: string, br: string) =>
  `${value}${br}    insecure-skip-tls-verify:${br}      true`;

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
        "LS0tLS1CRUdJTiBD",
        { provider: "generic", issuerUrl: "https://sso.example.com", clientId: "k8s" },
      );

      expect(yaml).toContain("kind: Config");
      expect(yaml).toContain("server: https://k8s.example.com:6443");
      expect(yaml).toContain("certificate-authority-data: LS0tLS1CRUdJTiBD");
      expect(yaml).toContain("command: kubelogin");
      expect(yaml).toContain("get-token");
      expect(yaml).toContain("--oidc-issuer-url=https://sso.example.com");
    });

    const oidc = { provider: "generic", issuerUrl: "https://sso.dev", clientId: "dev" } as const;

    it("refuses a remote cluster with no CA", () => {
      expect(() =>
        generateOidcKubeconfig("prod", "https://api.example.com:6443", null, oidc),
      ).toThrow(TlsBlockedError);
    });

    it("writes no skip flag for loopback with no CA", () => {
      const yaml = generateOidcKubeconfig("dev", "https://localhost:6443", null, oidc);
      expect(yaml).not.toContain("insecure-skip-tls-verify");
      expect(yaml).not.toContain("certificate-authority-data");
      expect(yaml).toContain('server: https://localhost:6443\n  name: "dev"');
    });

    it("writes the skip flag only on an explicit request", () => {
      const yaml = generateOidcKubeconfig("prod", "https://api.example.com:6443", null, oidc, {
        skipTlsVerify: true,
      });
      expect(yaml).toContain("insecure-skip-tls-verify: true");
    });
  });
});

describe.each(LINE_BREAKS)("a %s in the OIDC form", (_name, br) => {
  const remote = "https://api.example.com:6443";
  const oidc = {
    provider: "generic",
    issuerUrl: "https://sso.example.com",
    clientId: "c",
  } as const;

  it("is refused in the cluster name and the server URL", () => {
    expect(() => generateOidcKubeconfig(smuggle("p", br), remote, "LS0t", oidc)).toThrow(
      TlsBlockedError,
    );
    expect(() => generateOidcKubeconfig("p", smuggle(`${remote}/k8s`, br), "LS0t", oidc)).toThrow(
      TlsBlockedError,
    );
  });

  it("stays inside one quoted arg, also after a closing quote", () => {
    const secret = `x"${smuggle("", br)}`;
    const yaml = generateOidcKubeconfig("p", remote, "LS0t", { ...oidc, clientSecret: secret });
    expect(yaml).not.toMatch(/[\u0085\u2028\u2029]/);
    const config = parse(yaml) as {
      clusters: Array<{ cluster: Record<string, unknown> }>;
      users: Array<{ user: { exec: { args: string[] } } }>;
    };
    expect(config.clusters[0].cluster).toEqual({
      server: remote,
      "certificate-authority-data": "LS0t",
    });
    expect(config.users[0].user.exec.args).toContain(`--oidc-client-secret=${secret}`);
  });
});

const OK_NAMES = ["мій кластер", "prod east", 'a: "b" #c', "кластер 🚀"];
type NamedConfig = {
  clusters: Array<{ name: string }>;
  contexts: Array<{ name: string; context: { cluster: string } }>;
  "current-context": string;
};
const allNames = (config: NamedConfig) => [
  config.clusters[0].name,
  config.contexts[0].name,
  config.contexts[0].context.cluster,
  config["current-context"],
];

describe("names and emoji in an OIDC kubeconfig", () => {
  const remote = "https://api.example.com:6443";
  const oidc = {
    provider: "generic",
    issuerUrl: "https://sso.example.com",
    clientId: "c",
  } as const;

  it.each(OK_NAMES)("keeps the cluster name %s in all four places", (name) => {
    const config = parse(generateOidcKubeconfig(name, remote, "LS0t", oidc)) as NamedConfig;
    expect(allNames(config)).toEqual([name, name, name, name]);
  });

  it("writes an emoji in the secret as UTF-8", () => {
    const yaml = generateOidcKubeconfig("p", remote, "LS0t", { ...oidc, clientSecret: "x🚀" });
    expect(yaml).not.toMatch(/\\ud[89ab]/i);
    expect(
      (parse(yaml) as { users: Array<{ user: { exec: { args: string[] } } }> }).users[0].user.exec
        .args,
    ).toContain("--oidc-client-secret=x🚀");
  });
});
