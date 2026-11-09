import { describe, expect, it, vi } from "vitest";
import { probeClusterConnection } from "./probe-connection";

const mockKubectlRawFront = vi.fn();

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawArgsFront: (...args: unknown[]) => mockKubectlRawFront(...args),
}));

// What `kubectl cluster-info` really prints when the API server does not answer
// (measured on the bundled kubectl v1.37.2, card 3LPAnzex): exit 1, the hint on
// stdout, the cause on stderr. The hint alone used to count as "ready".
const DEBUG_HINT =
  "\nTo further debug and diagnose cluster problems, use 'kubectl cluster-info dump'.\n";
const wrapped = (stderr: string) => `[ERROR] [2026-11-05T07:53:25.488Z]: ${stderr}`;

describe("probeClusterConnection", () => {
  it("returns ready when the control plane line is printed and kubectl exits 0", async () => {
    mockKubectlRawFront.mockResolvedValue({
      output: "Kubernetes control plane is running at https://127.0.0.1:6443",
      errors: "",
      code: 0,
    });

    const result = await probeClusterConnection("my-context", "/tmp/kubeconfig");

    expect(result.status).toBe("ready");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.detail).toBeUndefined();
    expect(mockKubectlRawFront).toHaveBeenCalledWith([
      "cluster-info",
      "--context=my-context",
      "--kubeconfig=/tmp/kubeconfig",
      "--request-timeout=5s",
    ]);
  });

  it("passes a context name with spaces as one argument", async () => {
    mockKubectlRawFront.mockResolvedValue({
      output: "Kubernetes control plane is running at https://127.0.0.1:6443",
      errors: "",
      code: 0,
    });

    await probeClusterConnection("my team ctx", "/home/me/My Kube/config");

    expect(mockKubectlRawFront).toHaveBeenCalledWith([
      "cluster-info",
      "--context=my team ctx",
      "--kubeconfig=/home/me/My Kube/config",
      "--request-timeout=5s",
    ]);
  });

  it("accepts the legacy 'Kubernetes master is running at' line", async () => {
    mockKubectlRawFront.mockResolvedValue({
      output: "Kubernetes master is running at https://10.0.0.1:6443",
      errors: "",
      code: 0,
    });

    const result = await probeClusterConnection("old", "/tmp/kubeconfig");
    expect(result.status).toBe("ready");
  });

  it("stays ready when kubectl only warns on stderr with exit 0", async () => {
    mockKubectlRawFront.mockResolvedValue({
      output: "Kubernetes control plane is running at https://127.0.0.1:6443",
      errors: "W1105 07:53:25 loader.go:395] Config loaded from file",
      code: 0,
    });

    const result = await probeClusterConnection("my-context", "/tmp/kubeconfig");
    expect(result.status).toBe("ready");
  });

  it("returns ready without an exit code when the control plane line is present", async () => {
    // Browser fallback path: kubectlRawFront has no close code there.
    mockKubectlRawFront.mockResolvedValue({
      output: "Kubernetes control plane is running at https://127.0.0.1:6443",
      errors: "",
    });

    const result = await probeClusterConnection("my-context", "/tmp/kubeconfig");
    expect(result.status).toBe("ready");
  });

  it("returns unreachable on connection refused even though stdout is not empty", async () => {
    mockKubectlRawFront.mockResolvedValue({
      output: DEBUG_HINT,
      errors: wrapped(
        'E1105 07:53:25.488772 2041723 memcache.go:381] "Couldn\'t get current server API group list" err="Get \\"https://127.0.0.1:1/api?timeout=5s\\": dial tcp 127.0.0.1:1: connect: connection refused"\nUnable to connect to the server: dial tcp 127.0.0.1:1: connect: connection refused',
      ),
      code: 1,
    });

    const result = await probeClusterConnection("dead", "/tmp/kubeconfig");

    expect(result.status).toBe("unreachable");
    expect(result.detail).toContain("connection refused");
    expect(result.detail).not.toMatch(/^\[ERROR\]/);
  });

  it("returns unreachable on a request timeout", async () => {
    mockKubectlRawFront.mockResolvedValue({
      output: DEBUG_HINT,
      errors: wrapped(
        'Unable to connect to the server: Get "https://192.0.2.1:6443/api?timeout=5s": context deadline exceeded',
      ),
      code: 1,
    });

    const result = await probeClusterConnection("blackhole", "/tmp/kubeconfig");
    expect(result.status).toBe("unreachable");
    expect(result.detail).toContain("context deadline exceeded");
  });

  it("returns unreachable when the host does not resolve", async () => {
    mockKubectlRawFront.mockResolvedValue({
      output: DEBUG_HINT,
      errors: wrapped(
        "Unable to connect to the server: dial tcp: lookup no-such-host.invalid on 127.0.0.53:53: no such host",
      ),
      code: 1,
    });

    const result = await probeClusterConnection("nodns", "/tmp/kubeconfig");
    expect(result.status).toBe("unreachable");
  });

  it("returns unreachable when kubectl exits 0 without a control plane line", async () => {
    mockKubectlRawFront.mockResolvedValue({ output: DEBUG_HINT, errors: "", code: 0 });

    const result = await probeClusterConnection("odd", "/tmp/kubeconfig");
    expect(result.status).toBe("unreachable");
  });

  it("returns unreachable when the control plane line is printed but kubectl exits non-zero", async () => {
    mockKubectlRawFront.mockResolvedValue({
      output: "Kubernetes control plane is running at https://127.0.0.1:6443",
      errors: wrapped("error: something failed after the first line"),
      code: 1,
    });

    const result = await probeClusterConnection("half", "/tmp/kubeconfig");
    expect(result.status).toBe("unreachable");
  });

  it("returns auth-issue on unauthorized response", async () => {
    mockKubectlRawFront.mockResolvedValue({
      output: DEBUG_HINT,
      errors: wrapped("error: You must be logged in to the server (Unauthorized)"),
      code: 1,
    });

    const result = await probeClusterConnection("my-context", "/tmp/kubeconfig");
    expect(result.status).toBe("auth-issue");
    expect(result.detail).toBe("error: You must be logged in to the server (Unauthorized)");
  });

  it("returns auth-issue on forbidden response", async () => {
    mockKubectlRawFront.mockResolvedValue({
      output: "",
      errors: "Error from server (Forbidden): forbidden",
      code: 1,
    });

    const result = await probeClusterConnection("my-context", "/tmp/kubeconfig");
    expect(result.status).toBe("auth-issue");
  });

  it("returns auth-issue on certificate error", async () => {
    mockKubectlRawFront.mockResolvedValue({
      output: "",
      errors: "Unable to connect: x509: certificate signed by unknown authority",
      code: 1,
    });

    const result = await probeClusterConnection("my-context", "/tmp/kubeconfig");
    expect(result.status).toBe("auth-issue");
  });

  it("returns unreachable when only errors are returned", async () => {
    mockKubectlRawFront.mockResolvedValue({
      output: "",
      errors: "Unable to connect to the server: dial tcp 192.168.1.1:6443: i/o timeout",
      code: 1,
    });

    const result = await probeClusterConnection("my-context", "/tmp/kubeconfig");
    expect(result.status).toBe("unreachable");
  });

  it("returns unreachable on exception and keeps the message", async () => {
    mockKubectlRawFront.mockRejectedValue(new Error("process killed"));

    const result = await probeClusterConnection("my-context", "/tmp/kubeconfig");
    expect(result.status).toBe("unreachable");
    expect(result.detail).toBe("process killed");
  });
});
