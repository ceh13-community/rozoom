import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { appDataDir } from "@tauri-apps/api/path";
import { remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { getKubeBenchRelease, getKubescapeRelease, installKubescape } from "$shared/api/helm";
import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import {
  complianceHubState,
  fetchLatestKubeBenchLogs,
  installComplianceProvider,
  runKubeBenchScanNow,
  runComplianceHubScan,
  runKubescapeScanNow,
} from "./store";

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn().mockResolvedValue("/mock/app/data"),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: "appData" },
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("$shared/api/helm", () => ({
  getKubescapeRelease: vi.fn(),
  getKubeBenchRelease: vi.fn(),
  installKubescape: vi.fn(),
}));

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawArgsFront: vi.fn(),
}));

vi.mock("$features/check-health/model/cache-store", () => ({
  updateClusterCheckPartially: vi.fn(),
}));

import { updateClusterCheckPartially } from "$features/check-health/model/cache-store";

describe("compliance hub store", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    complianceHubState.set({});
    vi.mocked(appDataDir).mockResolvedValue("/mock/app/data");
    vi.mocked(writeTextFile).mockResolvedValue(undefined);
    vi.mocked(remove).mockResolvedValue(undefined);
    vi.mocked(getKubescapeRelease).mockResolvedValue({ installed: false });
    vi.mocked(getKubeBenchRelease).mockResolvedValue({ installed: false });
    vi.mocked(kubectlRawArgsFront).mockResolvedValue({
      code: 0,
      errors: "",
      output: JSON.stringify({ items: [] }),
    });
  });

  it("loads provider states and kubescape findings", async () => {
    vi.mocked(getKubescapeRelease).mockResolvedValue({
      installed: true,
      release: {
        name: "kubescape-operator",
        namespace: "kubescape",
        chart: "kubescape/kubescape-operator-1.26.0",
      },
    });
    vi.mocked(getKubeBenchRelease).mockResolvedValue({ installed: false });
    vi.mocked(kubectlRawArgsFront)
      .mockResolvedValueOnce({
        code: 0,
        errors: "",
        output: JSON.stringify({
          items: [
            {
              metadata: {
                name: "nsa-scan-old",
                namespace: "kubescape",
                creationTimestamp: "2026-02-17T11:00:00Z",
              },
              status: {
                framework: "NSA",
                summaryDetails: { failed: 2, passed: 50 },
                lastScanTime: "2026-02-17T11:05:00Z",
              },
            },
            {
              metadata: {
                name: "nsa-scan-latest",
                namespace: "kubescape",
                creationTimestamp: "2026-02-17T12:00:00Z",
              },
              status: {
                framework: "NSA",
                summaryDetails: { failed: 6, passed: 120 },
                lastScanTime: "2026-02-17T12:05:00Z",
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        code: 0,
        errors: "",
        output: JSON.stringify({ items: [] }),
      });

    const state = await runComplianceHubScan("cluster-a", { force: true });

    expect(state.summary.status).toBe("degraded");
    expect(state.providers).toHaveLength(2);
    expect(state.providers[0].status).toBe("installed");
    const kubescapeFinding = state.findings.find((finding) => finding.provider === "kubescape");
    expect(kubescapeFinding?.control).toBe("nsa-scan-latest");
    expect(kubescapeFinding?.framework).toBe("NSA");
    expect(updateClusterCheckPartially).toHaveBeenCalledWith(
      "cluster-a",
      expect.objectContaining({
        complianceSummary: expect.objectContaining({
          status: "degraded",
          findingCount: state.findings.length,
        }),
      }),
    );
  });

  it("reports unavailable when no provider is installed", async () => {
    vi.mocked(getKubescapeRelease).mockResolvedValue({ installed: false });
    vi.mocked(getKubeBenchRelease).mockResolvedValue({ installed: false });

    const state = await runComplianceHubScan("cluster-a", { force: true });

    expect(state.summary.status).toBe("unavailable");
    expect(state.summary.message).toContain("Install Kubescape or kube-bench");
  });

  it("falls back to vulnerability summaries when workload summaries are empty", async () => {
    vi.mocked(getKubescapeRelease).mockResolvedValue({
      installed: true,
      release: {
        name: "kubescape-operator",
        namespace: "kubescape",
        chart: "kubescape/kubescape-operator-1.26.0",
      },
    });
    vi.mocked(getKubeBenchRelease).mockResolvedValue({ installed: false });
    vi.mocked(kubectlRawArgsFront)
      .mockResolvedValueOnce({
        code: 0,
        errors: "",
        output: JSON.stringify({ items: [] }),
      })
      .mockResolvedValueOnce({
        code: 0,
        errors: "",
        output: JSON.stringify({ items: [] }),
      })
      .mockResolvedValueOnce({
        code: 0,
        errors: "",
        output: JSON.stringify({
          items: [
            {
              metadata: {
                name: "vuln-summary",
                namespace: "default",
                creationTimestamp: "2026-02-17T12:20:00Z",
              },
              status: {
                summary: {
                  severityCount: { critical: 1, high: 2, medium: 3, low: 4 },
                },
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        code: 0,
        errors: "",
        output: JSON.stringify({ items: [] }),
      });

    const state = await runComplianceHubScan("cluster-a", { force: true });

    const kubescapeFinding = state.findings.find((finding) => finding.provider === "kubescape");
    expect(kubescapeFinding?.framework).toBe("Kubescape Vulnerability");
    expect(kubescapeFinding?.severity).toBe("critical");
  });

  it("parses Controls/Totals payload into expandable details", async () => {
    vi.mocked(getKubescapeRelease).mockResolvedValue({
      installed: true,
      release: {
        name: "kubescape-operator",
        namespace: "kubescape",
        chart: "kubescape/kubescape-operator-1.26.0",
      },
    });
    vi.mocked(getKubeBenchRelease).mockResolvedValue({ installed: false });
    vi.mocked(kubectlRawArgsFront).mockResolvedValue({
      code: 0,
      errors: "",
      output: JSON.stringify({
        detected_version: "1.33",
        text: "Worker Node Security Configuration",
        Controls: [
          {
            id: "4",
            tests: [
              {
                section: "4.1",
                desc: "Worker Node Configuration Files",
                pass: 1,
                fail: 5,
                warn: 4,
                info: 0,
              },
              { section: "4.2", desc: "Kubelet", pass: 6, fail: 3, warn: 6, info: 0 },
              { section: "4.3", desc: "kube-proxy", pass: 1, fail: 0, warn: 0, info: 0 },
            ],
          },
        ],
        Totals: { total_pass: 8, total_fail: 8, total_warn: 10, total_info: 0 },
      }),
    });

    const state = await runComplianceHubScan("cluster-a", { force: true });

    expect(state.findings).toHaveLength(1);
    expect(state.findings[0].message).toBe("8 failed · 8 passed");
    expect(state.findings[0].details?.totals?.warn).toBe(10);
    expect(state.findings[0].details?.controls?.[0]?.id).toBe("4.1");
    expect(state.findings[0].details?.controls).toHaveLength(3);
  });

  it("installComplianceProvider installs kubescape and rejects kube-bench helm flow", async () => {
    vi.mocked(installKubescape).mockResolvedValue({ success: true });

    const kubescape = await installComplianceProvider("cluster-a", "kubescape");
    const kubeBench = await installComplianceProvider("cluster-a", "kube-bench");

    expect(kubescape.success).toBe(true);
    expect(kubeBench.success).toBe(false);
    expect(kubeBench.error).toContain("not supported");
    expect(installKubescape).toHaveBeenCalledWith("cluster-a", undefined, undefined);
    expect(get(complianceHubState)).toEqual({});
  });

  it("runKubescapeScanNow creates scan resource and refreshes state", async () => {
    vi.mocked(kubectlRawArgsFront)
      .mockResolvedValueOnce({
        code: 0,
        errors: "",
        output: JSON.stringify({
          spec: {
            group: "spdx.softwarecomposition.kubescape.io",
            versions: [{ name: "v1beta1", served: true, storage: true }],
          },
        }),
      })
      .mockResolvedValueOnce({
        code: 0,
        errors: "",
        output: "applied",
      })
      .mockResolvedValueOnce({
        code: 0,
        errors: "",
        output: JSON.stringify({ items: [] }),
      });
    vi.mocked(getKubescapeRelease).mockResolvedValue({ installed: false });
    vi.mocked(getKubeBenchRelease).mockResolvedValue({ installed: false });

    const result = await runKubescapeScanNow("cluster-a");

    expect(result.success).toBe(true);
    expect(vi.mocked(kubectlRawArgsFront).mock.calls[0]?.[0]?.[0]).toBe("get");
    expect(vi.mocked(kubectlRawArgsFront).mock.calls[1]?.[0]?.[0]).toBe("apply");
  });

  it("runKubeBenchScanNow creates kube-bench job manifest", async () => {
    vi.mocked(kubectlRawArgsFront).mockResolvedValueOnce({
      code: 0,
      errors: "",
      output: "applied",
    });
    vi.mocked(getKubescapeRelease).mockResolvedValue({ installed: false });
    vi.mocked(getKubeBenchRelease).mockResolvedValue({ installed: false });

    const result = await runKubeBenchScanNow("cluster-a");

    expect(result.success).toBe(true);
    expect(result.jobName).toContain("dashboard-kube-bench-");
    expect(vi.mocked(kubectlRawArgsFront).mock.calls[0]?.[0]?.[0]).toBe("apply");
    expect(vi.mocked(kubectlRawArgsFront)).toHaveBeenCalledTimes(1);
  });

  it("fetchLatestKubeBenchLogs returns clear error when no jobs exist", async () => {
    vi.mocked(kubectlRawArgsFront).mockResolvedValue({
      code: 0,
      errors: "",
      output: JSON.stringify({ items: [] }),
    });

    const result = await fetchLatestKubeBenchLogs("cluster-a");

    expect(result.success).toBe(false);
    expect(result.error).toContain("No kube-bench jobs found yet");
  });

  it("statusOnly refresh keeps existing kubescape findings and does not re-query kubescape resources", async () => {
    complianceHubState.set({
      "cluster-a": {
        summary: {
          status: "degraded",
          lastRunAt: "2026-02-18T20:00:00Z",
          message: "cached",
        },
        providers: [],
        findings: [
          {
            id: "kubescape-cached-1",
            provider: "kubescape",
            severity: "high",
            framework: "NSA",
            control: "cached-scan",
            phase: "Completed",
            message: "1 failed · 0 passed",
            updatedAt: "2026-02-18T20:00:00Z",
          },
        ],
      },
    });
    vi.mocked(getKubescapeRelease).mockResolvedValue({
      installed: true,
      release: {
        name: "kubescape-operator",
        namespace: "kubescape",
        chart: "kubescape/kubescape-operator-1.26.0",
      },
    });
    vi.mocked(getKubeBenchRelease).mockResolvedValue({ installed: false });
    vi.mocked(kubectlRawArgsFront).mockResolvedValue({
      code: 0,
      errors: "",
      output: JSON.stringify({ items: [] }),
    });

    const state = await runComplianceHubScan("cluster-a", { force: true, statusOnly: true });

    expect(state.findings.some((finding) => finding.id === "kubescape-cached-1")).toBe(true);
    expect(vi.mocked(kubectlRawArgsFront).mock.calls).toHaveLength(1);
    expect(vi.mocked(kubectlRawArgsFront).mock.calls[0]?.[0]).toEqual([
      "get",
      "jobs",
      "-A",
      "-l",
      "app.kubernetes.io/name=kube-bench",
      "-o",
      "json",
    ]);
  });
});
