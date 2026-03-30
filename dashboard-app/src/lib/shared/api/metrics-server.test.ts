import { describe, it, expect, vi } from "vitest";
import { deleteMetricsServerManifests } from "./metrics-server";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";

vi.mock("@/lib/shared/api/kubectl-proxy", () => ({
  kubectlRawFront: vi.fn(),
}));

describe("metrics-server kubectl cleanup", () => {
  const clusterId = "cluster-1";

  it("deletes metrics-server resources when no errors", async () => {
    vi.mocked(kubectlRawFront).mockResolvedValue({ output: "", errors: "", code: 0 });

    const result = await deleteMetricsServerManifests(clusterId);

    expect(result).toEqual({ success: true });
    expect(kubectlRawFront).toHaveBeenNthCalledWith(
      1,
      "delete deployment,service,serviceaccount -A -l k8s-app=metrics-server",
      { clusterId },
    );
    expect(kubectlRawFront).toHaveBeenNthCalledWith(
      2,
      "delete clusterrole,clusterrolebinding -l k8s-app=metrics-server",
      { clusterId },
    );
    expect(kubectlRawFront).toHaveBeenNthCalledWith(
      3,
      "delete role,rolebinding -A -l k8s-app=metrics-server",
      { clusterId },
    );
    expect(kubectlRawFront).toHaveBeenNthCalledWith(
      4,
      "delete apiservice -l k8s-app=metrics-server",
      { clusterId },
    );
  });

  it("returns error when deletion fails", async () => {
    vi.mocked(kubectlRawFront).mockResolvedValueOnce({
      output: "",
      errors: "boom",
      code: 1,
    });

    const result = await deleteMetricsServerManifests(clusterId);

    expect(result).toEqual({ success: false, error: "boom" });
  });
});
