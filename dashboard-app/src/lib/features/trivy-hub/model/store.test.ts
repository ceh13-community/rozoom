import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installTrivyOperator, listHelmReleases } from "$shared/api/helm";
import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import {
  installTrivyProvider,
  runTrivyHubScan,
  runTrivyScanNow,
  trivyHubReports,
  trivyHubState,
} from "./store";

vi.mock("$shared/api/helm", () => ({
  installTrivyOperator: vi.fn(),
  listHelmReleases: vi.fn(),
}));

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawArgsFront: vi.fn(),
}));

vi.mock("$features/check-health/model/cache-store", () => ({
  updateClusterCheckPartially: vi.fn(),
}));

import { updateClusterCheckPartially } from "$features/check-health/model/cache-store";

describe("trivy hub store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trivyHubState.set({});
    trivyHubReports.set({});
  });

  it("detects trivy operator from helm releases", async () => {
    vi.mocked(listHelmReleases).mockResolvedValue({
      releases: [
        {
          name: "trivy-operator",
          namespace: "trivy-system",
          chart: "aquasecurity/trivy-operator-0.22.0",
        },
      ],
    });

    const state = await runTrivyHubScan("cluster-a", { force: true });

    expect(state.summary.status).toBe("ok");
    expect(state.providers).toHaveLength(1);
    expect(state.providers[0]?.id).toBe("trivy-operator");
    expect(state.providers[0]?.status).toBe("installed");
    expect(updateClusterCheckPartially).toHaveBeenCalledWith(
      "cluster-a",
      expect.objectContaining({
        trivySummary: expect.objectContaining({
          status: "ok",
        }),
      }),
    );
  });

  it("delegates install for trivy operator", async () => {
    vi.mocked(installTrivyOperator).mockResolvedValue({ success: true });

    const result = await installTrivyProvider("cluster-a", "trivy-operator");

    expect(result.success).toBe(true);
    expect(installTrivyOperator).toHaveBeenCalledWith("cluster-a", undefined, undefined);
  });

  it("creates and persists trivy scan report", async () => {
    vi.mocked(listHelmReleases).mockResolvedValue({
      releases: [
        {
          name: "trivy-operator",
          namespace: "trivy-system",
          chart: "aquasecurity/trivy-operator-0.22.0",
        },
      ],
    });
    vi.mocked(kubectlRawArgsFront).mockResolvedValue({
      code: 0,
      errors: "",
      output: JSON.stringify({ items: [{}, {}] }),
    });

    const result = await runTrivyScanNow("cluster-a");
    const reports = get(trivyHubReports);

    expect(result.success).toBe(true);
    expect(result.report).toBeDefined();
    expect(reports["cluster-a"]).toBeTruthy();
  });
});
