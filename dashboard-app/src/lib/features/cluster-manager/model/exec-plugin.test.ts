import { describe, expect, it } from "vitest";
import { generateExecKubeconfig } from "./exec-plugin";
import { TlsBlockedError } from "./tls-gate";

const base = {
  kind: "generic",
  clusterName: "prod",
  command: "my-plugin",
} as const;
const remote = "https://api.example.com:6443";

describe("generateExecKubeconfig TLS", () => {
  it("writes the CA when given", () => {
    const yaml = generateExecKubeconfig({ ...base, serverUrl: remote, caData: "LS0t" });
    expect(yaml).toContain(`server: ${remote}\n    certificate-authority-data: LS0t\n  name: prod`);
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
