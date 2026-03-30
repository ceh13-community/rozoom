import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { resetApiserverMetricsCache } from "$shared/api/apiserver-metrics";
import { resetClusterVersionCache } from "$shared/api/cluster-version";
import {
  deprecationScanConfig,
  deprecationScanState,
  deprecationScanTargetVersionByCluster,
  parseDeprecatedApiMetrics,
  resetDeprecationScanRuntimeState,
  resourceToKind,
  runDeprecationScan,
  setDeprecationScanTargetVersion,
} from "./store";
import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import { execCli } from "$shared/api/cli";
import { getPlutoRelease } from "$shared/api/helm";

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawArgsFront: vi.fn(),
}));

vi.mock("$shared/api/cli", () => ({
  execCli: vi.fn(),
}));

vi.mock("$shared/api/helm", () => ({
  getPlutoRelease: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn().mockResolvedValue("/tmp/app"),
}));

describe("deprecation scan store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetApiserverMetricsCache();
    resetClusterVersionCache();
    resetDeprecationScanRuntimeState();
    deprecationScanState.set({});
    deprecationScanTargetVersionByCluster.set({});
    vi.mocked(getPlutoRelease).mockResolvedValue({ installed: false });
    deprecationScanConfig.set({
      targetVersion: "v1.31.0",
      cacheTtlMs: 1,
      scheduleMs: 86_400_000,
      enableFullScan: true,
      enableHelmScan: true,
      usePlutoForFullScan: true,
    });
  });

  it("parses deprecated api metrics and keeps request count", () => {
    const lines = [
      'apiserver_requested_deprecated_apis{group="",version="v1",resource="componentstatuses",removed_release="1.29"} 4',
      'apiserver_requested_deprecated_apis{group="apps",version="v1beta1",resource="deployments",removed_release="1.16"} 2',
    ].join("\n");

    const parsed = parseDeprecatedApiMetrics(lines);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].resource).toBe("componentstatuses");
    expect(parsed[0].value).toBe(4);
  });

  it("maps plural resource names to canonical kind names", () => {
    expect(resourceToKind("componentstatuses")).toBe("ComponentStatus");
    expect(resourceToKind("deployments")).toBe("Deployment");
    expect(resourceToKind("ingresses.networking.k8s.io")).toBe("Ingress");
  });

  it("stores per-cluster target version", () => {
    setDeprecationScanTargetVersion("cluster-a", "v1.32.0");
    const versions = get(deprecationScanTargetVersionByCluster);
    expect(versions["cluster-a"]).toBe("v1.32.0");
  });

  it("returns needsConfig when target version is invalid", async () => {
    deprecationScanConfig.set({
      targetVersion: null,
      cacheTtlMs: 1000,
      scheduleMs: 1000,
      enableFullScan: true,
      enableHelmScan: true,
      usePlutoForFullScan: true,
    });

    const summary = await runDeprecationScan("cluster-a", { force: true, source: "manual" });

    expect(summary.status).toBe("needsConfig");
    expect(summary.message).toContain("target Kubernetes version");
  });

  it("combines observed source with pluto source and reports trust", async () => {
    vi.mocked(kubectlRawArgsFront)
      .mockResolvedValueOnce({
        output: JSON.stringify({ serverVersion: { gitVersion: "v1.31.2" } }),
        errors: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        output:
          'apiserver_requested_deprecated_apis{group="",version="v1",resource="componentstatuses",removed_release="1.29"} 3',
        errors: "",
        code: 0,
      });

    vi.mocked(execCli)
      .mockResolvedValueOnce({
        code: 0,
        stdout: JSON.stringify([
          {
            kind: "Ingress",
            namespace: "default",
            name: "web",
            apiVersion: "extensions/v1beta1",
            removed_in: "1.22",
            replacement_api: "networking.k8s.io/v1",
          },
        ]),
        stderr: "",
      })
      .mockResolvedValueOnce({ code: 0, stdout: JSON.stringify([]), stderr: "" });

    const summary = await runDeprecationScan("cluster-a", { force: true, source: "manual" });

    expect(summary.status).toBe("critical");
    expect(summary.trustLevel).toBe("full");
    expect(summary.deprecatedCount).toBe(2);
    expect(summary.sourceSummaries.map((item) => item.id)).toEqual([
      "observed",
      "fullScan",
      "helmTemplate",
    ]);

    const state = get(deprecationScanState)["cluster-a"];
    expect(state?.history[0].issues.some((issue) => issue.status === "removed")).toBe(true);
    expect(state?.history[0].issues.some((issue) => issue.scope === "fullScan")).toBe(true);
  });

  it("shows observed-only trust and warnings when pluto is unavailable", async () => {
    vi.mocked(kubectlRawArgsFront)
      .mockResolvedValueOnce({
        output: JSON.stringify({ serverVersion: { gitVersion: "v1.31.0" } }),
        errors: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        output:
          'apiserver_requested_deprecated_apis{group="apps",version="v1beta1",resource="deployments",removed_release="1.16"} 1',
        errors: "",
        code: 0,
      });

    vi.mocked(execCli)
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "pluto: command not found" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "pluto: command not found" });

    const summary = await runDeprecationScan("cluster-a", { force: true, source: "manual" });

    expect(summary.trustLevel).toBe("observed");
    expect(summary.errors?.join(" ")).toContain("Pluto Helm release is not installed");
    expect(summary.warnings?.join(" ")).toContain("Only observed API request source is available");
  });

  it("falls back to installed pluto helm release when local pluto is unavailable", async () => {
    vi.mocked(getPlutoRelease).mockResolvedValue({
      installed: true,
      release: {
        name: "pluto",
        namespace: "pluto-system",
        chart: "fairwinds-stable/pluto-2.7.0",
        status: "deployed",
      },
    });

    vi.mocked(kubectlRawArgsFront)
      .mockResolvedValueOnce({
        output: JSON.stringify({ serverVersion: { gitVersion: "v1.31.0" } }),
        errors: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        output:
          'apiserver_requested_deprecated_apis{group="",version="v1",resource="componentstatuses",removed_release="1.29"} 1',
        errors: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [{ metadata: { name: "pluto-0" }, status: { phase: "Running" } }],
        }),
        errors: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        output: JSON.stringify([
          {
            kind: "Ingress",
            namespace: "default",
            name: "web",
            apiVersion: "extensions/v1beta1",
            removed_in: "1.22",
            replacement_api: "networking.k8s.io/v1",
          },
        ]),
        errors: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [{ metadata: { name: "pluto-0" }, status: { phase: "Running" } }],
        }),
        errors: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        output: JSON.stringify([]),
        errors: "",
        code: 0,
      });

    vi.mocked(execCli).mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "pluto: command not found",
    });

    const summary = await runDeprecationScan("cluster-a", { force: true, source: "manual" });

    expect(summary.trustLevel).toBe("full");
    expect(summary.sourceSummaries.find((source) => source.id === "fullScan")?.message).toContain(
      "Live scan via Helm release",
    );
  });

  it("deduplicates concurrent runs for the same cluster", async () => {
    let resolveVersion:
      | ((value: { output: string; errors: string; code: number }) => void)
      | undefined;
    vi.mocked(kubectlRawArgsFront)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveVersion = resolve;
          }) as any,
      )
      .mockResolvedValueOnce({
        output: "",
        errors: "",
        code: 0,
      });
    vi.mocked(execCli).mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "pluto: command not found",
    });

    const first = runDeprecationScan("cluster-a", { force: true, source: "auto" });
    const second = runDeprecationScan("cluster-a", { force: true, source: "auto" });

    await Promise.resolve();
    expect(kubectlRawArgsFront).toHaveBeenCalledTimes(1);

    resolveVersion?.({
      output: JSON.stringify({ serverVersion: { gitVersion: "v1.31.0" } }),
      errors: "",
      code: 0,
    });

    const [firstSummary, secondSummary] = await Promise.all([first, second]);
    expect(firstSummary).toEqual(secondSummary);
  });
});
