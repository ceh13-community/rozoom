import { load as parse } from "js-yaml";
import { describe, expect, it } from "vitest";
import { generateExecKubeconfig } from "./exec-plugin";
import { TlsBlockedError } from "./tls-gate";

const base = {
  kind: "generic",
  clusterName: "prod",
  command: "my-plugin",
} as const;
const remote = "https://api.example.com:6443";
const LINE_BREAKS = [
  ["NEL", "\u0085"],
  ["LS", "\u2028"],
  ["PS", "\u2029"],
  ["LF", "\n"],
] as const;
const smuggle = (value: string, br: string) =>
  `${value}${br}    insecure-skip-tls-verify:${br}      true`;

describe("generateExecKubeconfig TLS", () => {
  it("writes the CA when given", () => {
    const yaml = generateExecKubeconfig({ ...base, serverUrl: remote, caData: "LS0t" });
    expect(yaml).toContain(
      `server: ${remote}\n    certificate-authority-data: LS0t\n  name: "prod"`,
    );
    expect(yaml).not.toContain("insecure-skip-tls-verify");
  });

  it("refuses a remote cluster with no CA", () => {
    expect(() => generateExecKubeconfig({ ...base, serverUrl: remote })).toThrow(TlsBlockedError);
  });

  it("writes no skip flag for loopback with no CA", () => {
    const yaml = generateExecKubeconfig({ ...base, serverUrl: "https://127.0.0.1:6443" });
    expect(yaml).not.toContain("insecure-skip-tls-verify");
  });

  it("writes the skip flag only on an explicit request", () => {
    const yaml = generateExecKubeconfig({ ...base, serverUrl: remote, skipTlsVerify: true });
    expect(yaml).toContain("insecure-skip-tls-verify: true");
  });
});

describe.each(LINE_BREAKS)("a %s in the exec plugin form", (_name, br) => {
  it.each(["clusterName", "serverUrl"] as const)("is refused in %s", (field) => {
    const input = { ...base, serverUrl: `${remote}/k8s`, caData: "LS0t" };
    expect(() => generateExecKubeconfig({ ...input, [field]: smuggle(input[field], br) })).toThrow(
      TlsBlockedError,
    );
  });

  it("stays inside one quoted value in the command and the args", () => {
    const value = smuggle("x", br);
    const yaml = generateExecKubeconfig({
      ...base,
      serverUrl: remote,
      caData: "LS0t",
      command: value,
      args: [value],
    });
    expect(yaml).not.toMatch(/[\u0085\u2028\u2029]/);
    const config = parse(yaml) as {
      clusters: Array<{ cluster: Record<string, unknown> }>;
      users: Array<{ user: { exec: { command: string; args: string[] } } }>;
    };
    expect(config.clusters[0].cluster).toEqual({
      server: remote,
      "certificate-authority-data": "LS0t",
    });
    expect(config.users[0].user.exec.command).toBe(value);
    expect(config.users[0].user.exec.args).toEqual([value]);
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

describe.each(OK_NAMES)("the cluster name %s in an exec kubeconfig", (name) => {
  it("is kept in all four places", () => {
    const config = parse(
      generateExecKubeconfig({ ...base, clusterName: name, serverUrl: remote, caData: "LS0t" }),
    ) as NamedConfig;
    expect(allNames(config)).toEqual([name, name, name, name]);
  });
});

describe("an emoji in the exec plugin form", () => {
  it("is written as UTF-8 in the command and the args", () => {
    const value = "x🚀";
    const yaml = generateExecKubeconfig({
      ...base,
      serverUrl: remote,
      caData: "LS0t",
      command: value,
      args: [value],
    });
    expect(yaml).not.toMatch(/\\ud[89ab]/i);
    const exec = (parse(yaml) as { users: Array<{ user: { exec: Record<string, unknown> } }> })
      .users[0].user.exec;
    expect(exec.command).toBe(value);
    expect(exec.args).toEqual([value]);
  });
});
