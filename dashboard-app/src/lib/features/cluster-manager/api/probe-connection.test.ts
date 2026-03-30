import { describe, expect, it, vi } from "vitest";
import { probeClusterConnection } from "./probe-connection";

const mockKubectlRawFront = vi.fn();

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawFront: (...args: unknown[]) => mockKubectlRawFront(...args),
}));

describe("probeClusterConnection", () => {
  it("returns ready when cluster-info succeeds", async () => {
    mockKubectlRawFront.mockResolvedValue({
      output: "Kubernetes control plane is running at https://127.0.0.1:6443",
      errors: "",
    });

    const result = await probeClusterConnection("my-context", "/tmp/kubeconfig");

    expect(result.status).toBe("ready");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(mockKubectlRawFront).toHaveBeenCalledWith(
      expect.stringContaining("cluster-info --context=my-context"),
    );
  });

  it("returns auth-issue on unauthorized response", async () => {
    mockKubectlRawFront.mockResolvedValue({
      output: "",
      errors: "error: You must be logged in to the server (Unauthorized)",
    });

    const result = await probeClusterConnection("my-context", "/tmp/kubeconfig");
    expect(result.status).toBe("auth-issue");
  });

  it("returns auth-issue on forbidden response", async () => {
    mockKubectlRawFront.mockResolvedValue({
      output: "",
      errors: "Error from server (Forbidden): forbidden",
    });

    const result = await probeClusterConnection("my-context", "/tmp/kubeconfig");
    expect(result.status).toBe("auth-issue");
  });

  it("returns auth-issue on certificate error", async () => {
    mockKubectlRawFront.mockResolvedValue({
      output: "",
      errors: "Unable to connect: x509: certificate signed by unknown authority",
    });

    const result = await probeClusterConnection("my-context", "/tmp/kubeconfig");
    expect(result.status).toBe("auth-issue");
  });

  it("returns unreachable when only errors are returned", async () => {
    mockKubectlRawFront.mockResolvedValue({
      output: "",
      errors: "Unable to connect to the server: dial tcp 192.168.1.1:6443: i/o timeout",
    });

    const result = await probeClusterConnection("my-context", "/tmp/kubeconfig");
    expect(result.status).toBe("unreachable");
  });

  it("returns unreachable on exception", async () => {
    mockKubectlRawFront.mockRejectedValue(new Error("process killed"));

    const result = await probeClusterConnection("my-context", "/tmp/kubeconfig");
    expect(result.status).toBe("unreachable");
  });
});
