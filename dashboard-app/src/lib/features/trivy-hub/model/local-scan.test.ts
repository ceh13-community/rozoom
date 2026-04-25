import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$shared/api/cli", () => ({
  execCliForCluster: vi.fn(),
  resolveKubeconfigPath: vi.fn().mockResolvedValue("/tmp/kubeconfig"),
}));

import { execCliForCluster } from "$shared/api/cli";
import { runLocalTrivyK8sScan } from "./local-scan";

function makeSession() {
  const chunks: string[] = [];
  return {
    status: "idle" as const,
    output: "",
    expanded: false,
    dismissed: false,
    signal: undefined,
    isRunning: false,
    start: vi.fn(),
    append: vi.fn((chunk: string) => {
      chunks.push(chunk);
    }),
    succeed: vi.fn(),
    fail: vi.fn(),
    cancel: vi.fn(),
    toggleExpanded: vi.fn(),
    setExpanded: vi.fn(),
    dismiss: vi.fn(),
    reset: vi.fn(),
    chunks,
  };
}

describe("runLocalTrivyK8sScan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses trivy k8s output into VulnItem/MisconfigItem/SecretItem with source=local", async () => {
    const payload = {
      Resources: [
        {
          Namespace: "default",
          Kind: "Pod",
          Name: "nginx-abc",
          Results: [
            {
              Target: "nginx:1.25",
              Vulnerabilities: [
                {
                  VulnerabilityID: "CVE-2024-1234",
                  PkgName: "openssl",
                  InstalledVersion: "3.0.0",
                  FixedVersion: "3.0.1",
                  Severity: "HIGH",
                  Title: "ok title",
                  PrimaryURL: "https://nvd",
                  CVSS: { nvd: { V3Score: 7.5 } },
                },
              ],
              Misconfigurations: [
                {
                  AVDID: "AVD-KSV-0001",
                  ID: "KSV001",
                  Severity: "MEDIUM",
                  Title: "mc title",
                  Description: "mc desc",
                  Message: "run as non-root",
                },
              ],
              Secrets: [
                {
                  RuleID: "aws-access-key-id",
                  Severity: "CRITICAL",
                  Title: "AWS key",
                  Category: "AWS",
                  Match: "AKIA...",
                },
              ],
            },
          ],
        },
      ],
    };

    vi.mocked(execCliForCluster).mockResolvedValue({
      code: 0,
      stdout: JSON.stringify(payload),
      stderr: "",
    });

    const session = makeSession();
    const result = await runLocalTrivyK8sScan("cluster-a", session);

    expect(result.success).toBe(true);
    expect(result.vulns).toEqual([
      {
        namespace: "default",
        resource: "Pod-nginx-abc",
        image: "nginx:1.25",
        vulnerabilityID: "CVE-2024-1234",
        severity: "high",
        pkgName: "openssl",
        installedVersion: "3.0.0",
        fixedVersion: "3.0.1",
        title: "ok title",
        primaryLink: "https://nvd",
        score: 7.5,
        source: "local",
      },
    ]);
    expect(result.misconfigs).toHaveLength(1);
    expect(result.misconfigs[0]).toMatchObject({
      checkID: "AVD-KSV-0001",
      severity: "medium",
      source: "local",
      messages: ["run as non-root"],
    });
    expect(result.secrets).toHaveLength(1);
    expect(result.secrets[0]).toMatchObject({
      ruleID: "aws-access-key-id",
      severity: "critical",
      target: "nginx:1.25",
      source: "local",
    });
  });

  it("returns failure with parse error when stdout is not JSON", async () => {
    vi.mocked(execCliForCluster).mockResolvedValue({
      code: 0,
      stdout: "not json",
      stderr: "",
    });

    const session = makeSession();
    const result = await runLocalTrivyK8sScan("cluster-a", session);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Failed to parse trivy JSON/);
    expect(result.vulns).toHaveLength(0);
  });

  it("surfaces cli exit code + stderr when trivy fails with no stdout", async () => {
    vi.mocked(execCliForCluster).mockResolvedValue({
      code: 2,
      stdout: "",
      stderr: "kubeconfig not found",
    });

    const session = makeSession();
    const result = await runLocalTrivyK8sScan("cluster-a", session);

    expect(result.success).toBe(false);
    expect(result.error).toContain("kubeconfig not found");
  });

  it("falls back to empty V3Score when CVSS data is missing", async () => {
    vi.mocked(execCliForCluster).mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({
        Resources: [
          {
            Namespace: "ns",
            Kind: "Pod",
            Name: "p",
            Results: [
              {
                Target: "img",
                Vulnerabilities: [{ VulnerabilityID: "CVE-X", Severity: "LOW" }],
              },
            ],
          },
        ],
      }),
      stderr: "",
    });

    const session = makeSession();
    const result = await runLocalTrivyK8sScan("cluster-a", session);
    expect(result.success).toBe(true);
    expect(result.vulns[0]?.score).toBe(0);
  });
});
