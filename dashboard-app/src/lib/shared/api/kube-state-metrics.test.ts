import { describe, it, expect, vi } from "vitest";
import { deleteKubeStateMetricsManifests } from "./kube-state-metrics";

vi.mock("@/lib/shared/api/kubectl-proxy", () => ({
  kubectlRawFront: vi.fn(),
}));

import { kubectlRawFront } from "$shared/api/kubectl-proxy";

const mockedKubectl = vi.mocked(kubectlRawFront);

describe("deleteKubeStateMetricsManifests", () => {
  const clusterId = "cluster-1";

  it("deletes kube-state-metrics resources when no errors", async () => {
    mockedKubectl.mockResolvedValue({ output: "", errors: "" });

    const result = await deleteKubeStateMetricsManifests(clusterId);

    expect(result).toEqual({ success: true });
    expect(mockedKubectl).toHaveBeenCalledTimes(3);
    expect(mockedKubectl).toHaveBeenCalledWith(
      "delete deployment,service,serviceaccount -A -l app.kubernetes.io/name=kube-state-metrics",
      { clusterId },
    );
  });

  it("returns error when workloads delete fails", async () => {
    mockedKubectl.mockResolvedValueOnce({ output: "", errors: "boom" });

    const result = await deleteKubeStateMetricsManifests(clusterId);

    expect(result).toEqual({ success: false, error: "boom" });
  });
});
