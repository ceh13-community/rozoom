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
});
