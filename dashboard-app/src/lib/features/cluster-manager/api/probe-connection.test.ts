import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROBE_TIMEOUT_MS, probeClusterConnection, shortProbeReason } from "./probe-connection";

const mockKubectl = vi.fn();

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawArgsFront: (...args: unknown[]) => mockKubectl(...args),
}));

// What `kubectl cluster-info` really prints when the API server does not answer
// (bundled kubectl v1.37.2, card 3LPAnzex and the reviewer's stand on 09/11): exit 1,
// the hint on stdout, retry lines then the verdict on stderr.
const DEBUG_HINT =
  "\nTo further debug and diagnose cluster problems, use 'kubectl cluster-info dump'.\n";
const wrapped = (stderr: string) => `[ERROR] [2026-11-05T07:53:25.488Z]: ${stderr}`;
const READY_OUTPUT = "Kubernetes control plane is running at https://127.0.0.1:6443";

beforeEach(() => {
  mockKubectl.mockReset();
});

describe("probeClusterConnection", () => {
  it("returns ready when the control plane line is printed and kubectl exits 0", async () => {
    mockKubectl.mockResolvedValue({ output: READY_OUTPUT, errors: "", code: 0 });

    const result = await probeClusterConnection("my-context", "/tmp/kubeconfig");

    expect(result.status).toBe("ready");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.detail).toBeUndefined();
    expect(mockKubectl).toHaveBeenCalledWith(
      [
        "cluster-info",
        "--context=my-context",
        "--kubeconfig=/tmp/kubeconfig",
        "--request-timeout=5s",
      ],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("passes no --kubeconfig for the merged default config", async () => {
    mockKubectl.mockResolvedValue({ output: READY_OUTPUT, errors: "", code: 0 });

    await probeClusterConnection("only-env", null);
    expect(mockKubectl.mock.calls[0]?.[0]).toEqual([
      "cluster-info",
      "--context=only-env",
      "--request-timeout=5s",
    ]);

    await probeClusterConnection("only-env", "");
    expect(mockKubectl.mock.calls[1]?.[0]).toEqual([
      "cluster-info",
      "--context=only-env",
      "--request-timeout=5s",
    ]);
  });

  it("passes a context name with spaces as one argument", async () => {
    mockKubectl.mockResolvedValue({ output: READY_OUTPUT, errors: "", code: 0 });

    await probeClusterConnection("my team ctx", "/home/me/My Kube/config");

    expect(mockKubectl.mock.calls[0]?.[0]).toEqual([
      "cluster-info",
      "--context=my team ctx",
      "--kubeconfig=/home/me/My Kube/config",
      "--request-timeout=5s",
    ]);
  });

  it("checks Ready first: a server URL containing 'certificate' is still ready", async () => {
    mockKubectl.mockResolvedValue({
      output: "Kubernetes control plane is running at https://certificate.example.internal:6443",
      errors: "",
      code: 0,
    });

    expect((await probeClusterConnection("c", null)).status).toBe("ready");
  });

  it("stays ready when kubectl only warns on stderr with exit 0", async () => {
    mockKubectl.mockResolvedValue({
      output: READY_OUTPUT,
      errors: "W1105 07:53:25 loader.go:395] Config loaded from file",
      code: 0,
    });

    expect((await probeClusterConnection("c", null)).status).toBe("ready");
  });

  it("returns ready without an exit code when the control plane line is present", async () => {
    // Browser fallback path: no close code there.
    mockKubectl.mockResolvedValue({ output: READY_OUTPUT, errors: "" });

    expect((await probeClusterConnection("c", null)).status).toBe("ready");
  });

  it("returns unreachable on connection refused, detail is the last stderr line", async () => {
    mockKubectl.mockResolvedValue({
      output: DEBUG_HINT,
      errors: wrapped(
        'E1105 07:53:25.488772 2041723 memcache.go:381] "Couldn\'t get current server API group list" err="Get \\"https://127.0.0.1:1/api?timeout=5s\\": dial tcp 127.0.0.1:1: connect: connection refused"\nUnable to connect to the server: dial tcp 127.0.0.1:1: connect: connection refused',
      ),
      code: 1,
    });

    const result = await probeClusterConnection("dead", null);

    expect(result.status).toBe("unreachable");
    expect(result.detail).toBe(
      "Unable to connect to the server: dial tcp 127.0.0.1:1: connect: connection refused",
    );
  });

  it("returns unreachable on a silent server (both measured timeout shapes)", async () => {
    mockKubectl.mockResolvedValue({
      output: DEBUG_HINT,
      errors: wrapped(
        'Unable to connect to the server: Get "https://192.0.2.1:6443/api?timeout=5s": context deadline exceeded',
      ),
      code: 1,
    });
    expect((await probeClusterConnection("blackhole", null)).status).toBe("unreachable");

    mockKubectl.mockResolvedValue({
      output: DEBUG_HINT,
      errors: wrapped(
        'E1109 09:12:59.384542 195103 memcache.go:265] "Unhandled Error" err="couldn\'t get current server API group list: Get \\"https://192.0.2.1:6443/api?timeout=5s\\": net/http: request canceled while waiting for connection (Client.Timeout exceeded while awaiting headers)"\nUnable to connect to the server: net/http: request canceled while waiting for connection (Client.Timeout exceeded while awaiting headers)',
      ),
      code: 1,
    });
    const result = await probeClusterConnection("blackhole", null);
    expect(result.status).toBe("unreachable");
    expect(shortProbeReason(result.detail)).toBe("No answer from the server");
  });

  it("returns unreachable when the host does not resolve", async () => {
    mockKubectl.mockResolvedValue({
      output: DEBUG_HINT,
      errors: wrapped(
        "Unable to connect to the server: dial tcp: lookup no-such-host.invalid on 127.0.0.53:53: no such host",
      ),
      code: 1,
    });

    const result = await probeClusterConnection("nodns", null);
    expect(result.status).toBe("unreachable");
    expect(shortProbeReason(result.detail)).toBe("Host name not found");
  });

  it("returns unreachable when kubectl exits 0 without a control plane line", async () => {
    mockKubectl.mockResolvedValue({ output: DEBUG_HINT, errors: "", code: 0 });
    expect((await probeClusterConnection("odd", null)).status).toBe("unreachable");
  });

  it("returns unreachable when the control plane line is printed but kubectl exits non-zero", async () => {
    mockKubectl.mockResolvedValue({
      output: READY_OUTPUT,
      errors: wrapped("error: something failed after the first line"),
      code: 1,
    });
    expect((await probeClusterConnection("half", null)).status).toBe("unreachable");
  });

  // Verbatim kubectl 1.37.2 lines from the reviewer's stand (verdict-pr223.md, finding 4).
  it("returns auth-issue on a real 401 (the server asked for credentials)", async () => {
    mockKubectl.mockResolvedValue({
      output: DEBUG_HINT,
      errors: wrapped(
        "error: You must be logged in to the server (the server has asked for the client to provide credentials)",
      ),
      code: 1,
    });

    const result = await probeClusterConnection("c", null);
    expect(result.status).toBe("auth-issue");
    expect(result.detail).toBe(
      "error: You must be logged in to the server (the server has asked for the client to provide credentials)",
    );
  });

  it("returns auth-issue when the credential plugin fails or is missing", async () => {
    mockKubectl.mockResolvedValue({
      output: DEBUG_HINT,
      errors: wrapped(
        "Unable to connect to the server: getting credentials: exec: executable aws not found\n\nIt looks like you are trying to use a client-go credential plugin that is not installed.",
      ),
      code: 1,
    });
    const missing = await probeClusterConnection("eks", null);
    expect(missing.status).toBe("auth-issue");
    expect(
      shortProbeReason(
        "Unable to connect to the server: getting credentials: exec: executable aws not found",
      ),
    ).toBe("Credential plugin failed");

    mockKubectl.mockResolvedValue({
      output: DEBUG_HINT,
      errors: wrapped(
        "Unable to connect to the server: getting credentials: exec: executable kubelogin failed with exit code 255",
      ),
      code: 1,
    });
    expect((await probeClusterConnection("sso", null)).status).toBe("auth-issue");
  });

  it("returns auth-issue on unauthorized, forbidden and certificate errors", async () => {
    for (const stderr of [
      "error: You must be logged in to the server (Unauthorized)",
      "Error from server (Forbidden): forbidden",
      "Unable to connect: x509: certificate signed by unknown authority",
    ]) {
      mockKubectl.mockResolvedValue({ output: "", errors: stderr, code: 1 });
      expect((await probeClusterConnection("c", null)).status).toBe("auth-issue");
    }
  });

  it("returns unreachable when only errors are returned", async () => {
    mockKubectl.mockResolvedValue({
      output: "",
      errors: "Unable to connect to the server: dial tcp 192.168.1.1:6443: i/o timeout",
      code: 1,
    });
    const result = await probeClusterConnection("c", null);
    expect(result.status).toBe("unreachable");
    expect(shortProbeReason(result.detail)).toBe("No answer from the server");
  });

  it("returns unreachable on exception and keeps the message", async () => {
    mockKubectl.mockRejectedValue(new Error("process killed"));

    const result = await probeClusterConnection("c", null);
    expect(result.status).toBe("unreachable");
    expect(result.detail).toBe("process killed");
  });

  describe("time bound", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("aborts a probe that never returns and says so", async () => {
      mockKubectl.mockImplementation(
        (_args: string[], options: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () =>
              reject(new DOMException("Kubectl request aborted", "AbortError")),
            );
          }),
      );

      const pending = probeClusterConnection("hung", null, { timeoutMs: 1_000 });
      await vi.advanceTimersByTimeAsync(999);
      expect(mockKubectl.mock.calls[0]?.[1].signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      const result = await pending;
      expect(result.status).toBe("unreachable");
      expect(result.detail).toBe(
        "Gave up after 1 s: kubectl did not return. Its credential plugin may still be running.",
      );
      expect(shortProbeReason(result.detail)).toBeNull();
    });

    it("defaults to a bound above kubectl's own 25 s of discovery retries", () => {
      expect(PROBE_TIMEOUT_MS).toBeGreaterThan(25_100);
    });

    it("forwards an outer abort signal", async () => {
      mockKubectl.mockImplementation(
        (_args: string[], options: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () =>
              reject(new DOMException("Kubectl request aborted", "AbortError")),
            );
          }),
      );
      const outer = new AbortController();
      const pending = probeClusterConnection("hung", null, { signal: outer.signal });
      outer.abort();
      const result = await pending;
      expect(result.status).toBe("unreachable");
      expect(result.detail).toBe("Kubectl request aborted");
    });
  });
});

describe("shortProbeReason", () => {
  it("maps the measured failure shapes", () => {
    expect(
      shortProbeReason(
        "Unable to connect to the server: dial tcp 127.0.0.1:1: connect: connection refused",
      ),
    ).toBe("Connection refused");
    expect(
      shortProbeReason(
        'Unable to connect to the server: Get "https://192.0.2.1:6443/api?timeout=5s": context deadline exceeded',
      ),
    ).toBe("No answer from the server");
    expect(
      shortProbeReason(
        "Unable to connect to the server: dial tcp: lookup no-such-host.invalid on 127.0.0.53:53: no such host",
      ),
    ).toBe("Host name not found");
  });

  it("returns null for unmeasured shapes and empty input", () => {
    expect(
      shortProbeReason(
        "error: You must be logged in to the server (the server has asked for the client to provide credentials)",
      ),
    ).toBeNull();
    expect(
      shortProbeReason("Unable to connect: x509: certificate signed by unknown authority"),
    ).toBeNull();
    expect(shortProbeReason("process killed")).toBeNull();
    expect(shortProbeReason("")).toBeNull();
    expect(shortProbeReason(undefined)).toBeNull();
  });
});
