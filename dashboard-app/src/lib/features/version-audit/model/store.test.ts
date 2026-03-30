import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { resetClusterVersionCache } from "$shared/api/cluster-version";
import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import { listHelmReleases } from "$shared/api/helm";
import { execCli } from "$shared/api/cli";
import { runVersionAudit, versionAuditConfig, versionAuditState } from "./store";

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawArgsFront: vi.fn(),
}));

vi.mock("$shared/api/helm", () => ({
  listHelmReleases: vi.fn(),
}));

vi.mock("$shared/api/cli", () => ({
  execCli: vi.fn(),
}));

describe("version audit store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClusterVersionCache();
    versionAuditState.set({});
    versionAuditConfig.set({
      minSupportedVersion: "v1.25.0",
      cacheTtlMs: 1,
      scheduleMs: 600_000,
    });
  });

  it("marks charts as outdated when newer repo version exists", async () => {
    vi.mocked(kubectlRawArgsFront).mockResolvedValueOnce({
      output: JSON.stringify({ serverVersion: { gitVersion: "v1.31.2" } }),
      errors: "",
      code: 0,
    });
    vi.mocked(listHelmReleases).mockResolvedValueOnce({
      releases: [{ name: "kps", namespace: "monitoring", chart: "kube-state-metrics-5.30.1" }],
    });
    vi.mocked(execCli).mockResolvedValueOnce({
      code: 0,
      stdout: JSON.stringify([
        { name: "prometheus-community/kube-state-metrics", version: "5.31.0" },
      ]),
      stderr: "",
    });

    const summary = await runVersionAudit("cluster-a", { force: true, source: "manual" });
    const latest = get(versionAuditState)["cluster-a"]?.history[0]?.charts[0];

    expect(summary.outdatedCharts).toBe(1);
    expect(latest?.latest).toBe("5.31.0");
    expect(latest?.status).toBe("outdated");
  });

  it("keeps unknown status when chart is not found in helm repos", async () => {
    vi.mocked(kubectlRawArgsFront).mockResolvedValueOnce({
      output: JSON.stringify({ serverVersion: { gitVersion: "v1.31.2" } }),
      errors: "",
      code: 0,
    });
    vi.mocked(listHelmReleases).mockResolvedValueOnce({
      releases: [{ name: "custom", namespace: "default", chart: "my-custom-chart-1.0.0" }],
    });
    vi.mocked(execCli).mockResolvedValueOnce({
      code: 0,
      stdout: JSON.stringify([]),
      stderr: "",
    });

    await runVersionAudit("cluster-a", { force: true, source: "manual" });
    const chart = get(versionAuditState)["cluster-a"]?.history[0]?.charts[0];

    expect(chart?.status).toBe("unknown");
    expect(chart?.error).toContain("not found");
  });

  it("adds audit errors when helm lookup command fails", async () => {
    vi.mocked(kubectlRawArgsFront).mockResolvedValueOnce({
      output: JSON.stringify({ serverVersion: { gitVersion: "v1.31.2" } }),
      errors: "",
      code: 0,
    });
    vi.mocked(listHelmReleases).mockResolvedValueOnce({
      releases: [{ name: "kps", namespace: "monitoring", chart: "kube-state-metrics-5.30.1" }],
    });
    vi.mocked(execCli).mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "repository cache is corrupt",
    });

    const summary = await runVersionAudit("cluster-a", { force: true, source: "manual" });

    expect(summary.errors?.join(" ")).toContain("repository cache is corrupt");
  });

  it("deduplicates concurrent runs for the same cluster", async () => {
    let resolveVersion:
      | ((value: { output: string; errors: string; code: number }) => void)
      | undefined;
    vi.mocked(kubectlRawArgsFront).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveVersion = resolve;
        }) as any,
    );
    vi.mocked(listHelmReleases).mockResolvedValue({
      releases: [],
    });

    const first = runVersionAudit("cluster-a", { force: true, source: "auto" });
    const second = runVersionAudit("cluster-a", { force: true, source: "auto" });

    expect(kubectlRawArgsFront).toHaveBeenCalledTimes(1);

    resolveVersion?.({
      output: JSON.stringify({ serverVersion: { gitVersion: "v1.31.2" } }),
      errors: "",
      code: 0,
    });

    const [firstSummary, secondSummary] = await Promise.all([first, second]);
    expect(firstSummary).toEqual(secondSummary);
    expect(listHelmReleases).toHaveBeenCalledTimes(1);
  });
});
