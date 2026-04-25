import { describe, expect, it, vi } from "vitest";

const kubectlRawFront = vi.fn();
const logError = vi.fn();

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawFront,
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  error: logError,
}));

describe("checkCertificatesHealth", () => {
  it("aborts the underlying kubectl request when the control-plane probe times out", async () => {
    vi.useFakeTimers();
    kubectlRawFront.mockImplementation((command: string, options?: { signal?: AbortSignal }) => {
      if (command === "get nodes -o json") {
        return Promise.resolve({
          output: JSON.stringify({ items: [] }),
          errors: "",
          code: 0,
        });
      }
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Kubectl request aborted", "AbortError"));
        });
      });
    });

    const { checkCertificatesHealth } = await import("./check-certificates-health");
    const pending = checkCertificatesHealth("cluster-a", { force: true });

    await vi.advanceTimersByTimeAsync(12_000);
    const report = await pending;

    expect(report.status).toBe("unknown");
    expect(report.errors).toBe("find-control-plane-pod kubectl call timeout after 12000ms");
    expect(kubectlRawFront).toHaveBeenCalledWith(
      "get pods -n kube-system -l component=kube-apiserver -o json",
      expect.objectContaining({
        clusterId: "cluster-a",
        source: "check-certificates-health:find-control-plane-pod",
        signal: expect.any(AbortSignal),
      }),
    );
    const firstCallSignal = kubectlRawFront.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(firstCallSignal.aborted).toBe(true);
    expect(logError).toHaveBeenCalledWith(
      "Control-plane cert check failed: find-control-plane-pod kubectl call timeout after 12000ms",
    );

    vi.useRealTimers();
  }, 10_000);

  it("falls back to CSR evidence when /nodes/<node>/proxy/configz is unreachable", async () => {
    kubectlRawFront.mockReset();
    logError.mockReset();
    const recent = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    kubectlRawFront.mockImplementation((command: string) => {
      if (command === "get pods -n kube-system -l component=kube-apiserver -o json")
        return Promise.resolve({ output: JSON.stringify({ items: [] }), errors: "", code: 0 });
      if (command === "get pods -n kube-system -l k8s-app=kube-apiserver -o json")
        return Promise.resolve({ output: JSON.stringify({ items: [] }), errors: "", code: 0 });
      if (command === "get nodes -o json")
        return Promise.resolve({
          output: JSON.stringify({
            items: [{ metadata: { name: "node-a" } }, { metadata: { name: "node-b" } }],
          }),
          errors: "",
          code: 0,
        });
      if (command === "get csr -o json")
        return Promise.resolve({
          output: JSON.stringify({
            items: [
              {
                metadata: { name: "csr-1", creationTimestamp: recent },
                spec: {
                  signerName: "kubernetes.io/kubelet-serving",
                  username: "system:node:node-a",
                },
                status: { conditions: [{ type: "Approved", status: "True" }] },
              },
              {
                metadata: { name: "csr-2", creationTimestamp: recent },
                spec: {
                  signerName: "kubernetes.io/kube-apiserver-client-kubelet",
                  username: "system:node:node-a",
                },
                status: { conditions: [{ type: "Approved", status: "True" }] },
              },
            ],
          }),
          errors: "",
          code: 0,
        });
      if (command.startsWith("get --raw /api/v1/nodes/"))
        return Promise.resolve({
          output: "",
          errors: "Error from server (Forbidden)",
          code: 1,
        });
      return Promise.resolve({ output: "", errors: "unexpected", code: 1 });
    });

    const { checkCertificatesHealth } = await import("./check-certificates-health");
    const report = await checkCertificatesHealth("cluster-csr", { force: true });

    const nodeA = report.kubeletRotation.find((r) => r.node === "node-a");
    const nodeB = report.kubeletRotation.find((r) => r.node === "node-b");
    expect(nodeA?.status).toBe("enabled");
    expect(nodeA?.rotateClient).toBe(true);
    expect(nodeA?.rotateServer).toBe(true);
    expect(nodeA?.message).toMatch(/inferred from approved csr/i);
    // node-b has no CSR evidence and configz fails -> stays unknown
    // with an improved error message.
    expect(nodeB?.status).toBe("unknown");
    expect(nodeB?.message).toMatch(/no recent kubelet csr/i);
  });
});
