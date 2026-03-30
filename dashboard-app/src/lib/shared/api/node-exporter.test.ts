import { describe, it, expect, vi } from "vitest";
import { deleteNodeExporterManifests } from "./node-exporter";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";

vi.mock("@/lib/shared/api/kubectl-proxy", () => ({
  kubectlRawFront: vi.fn(),
}));

describe("node-exporter kubectl cleanup", () => {
  const clusterId = "cluster-1";

  it("deletes node-exporter resources when no errors", async () => {
    vi.mocked(kubectlRawFront).mockResolvedValue({ output: "", errors: "", code: 0 });

    const result = await deleteNodeExporterManifests(clusterId);

    expect(result).toEqual({ success: true });
    expect(kubectlRawFront).toHaveBeenNthCalledWith(
      1,
      "delete daemonset,service,serviceaccount -A -l app.kubernetes.io/name=prometheus-node-exporter",
      { clusterId },
    );
    expect(kubectlRawFront).toHaveBeenNthCalledWith(
      2,
      "delete clusterrole,clusterrolebinding -l app.kubernetes.io/name=prometheus-node-exporter",
      { clusterId },
    );
    expect(kubectlRawFront).toHaveBeenNthCalledWith(
      3,
      "delete role,rolebinding -A -l app.kubernetes.io/name=prometheus-node-exporter",
      { clusterId },
    );
  });

  it("returns error when deletion fails", async () => {
    vi.mocked(kubectlRawFront).mockResolvedValueOnce({
      output: "",
      errors: "boom",
      code: 1,
    });

    const result = await deleteNodeExporterManifests(clusterId);

    expect(result).toEqual({ success: false, error: "boom" });
  });
});
