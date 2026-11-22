import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
}));

vi.mock("@/lib/shared/api/kubectl-proxy", () => ({
  kubectlRawFront: vi.fn(),
}));

import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { checkIngressStatus } from "./check-ingress-status";

const mockedKubectl = vi.mocked(kubectlRawFront);

describe("checkIngressStatus", () => {
  const clusterId = "cluster-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok when all ingresses have TLS", async () => {
    mockedKubectl.mockResolvedValue({
      output: [
        "default   my-app   app.example.com   my-tls-secret",
        "prod      api      api.example.com   api-tls-secret",
      ].join("\n"),
      errors: "",
      code: 0,
    });

    const result = await checkIngressStatus(clusterId, { force: true });

    expect(result.status).toBe("ok");
    expect(result.summary.total).toBe(2);
    expect(result.summary.withTls).toBe(2);
    expect(result.summary.withoutTls).toBe(0);
    expect(result.items).toHaveLength(2);
  });

  it("returns warning when some ingresses lack TLS", async () => {
    mockedKubectl.mockResolvedValue({
      output: [
        "default   my-app   app.example.com   my-tls-secret",
        "staging   web      web.staging.com   <none>",
      ].join("\n"),
      errors: "",
      code: 0,
    });

    const result = await checkIngressStatus(clusterId, { force: true });

    expect(result.status).toBe("warning");
    expect(result.summary.total).toBe(2);
    expect(result.summary.withTls).toBe(1);
    expect(result.summary.withoutTls).toBe(1);
  });

  // kubectl prints "No resources found" to stderr with exit 0; kubectlRawFront drops stderr
  // at exit 0, so the caller sees empty output and empty errors.
  it("returns ok with total 0 when the cluster has no ingresses", async () => {
    mockedKubectl.mockResolvedValue({
      output: "",
      errors: "",
      code: 0,
    });

    const result = await checkIngressStatus(clusterId, { force: true });

    expect(result.status).toBe("ok");
    expect(result.summary.total).toBe(0);
    expect(result.summary.withoutTls).toBe(0);
  });

  it("returns unknown on kubectl error", async () => {
    mockedKubectl.mockResolvedValue({
      output: "",
      errors: "connection refused",
      code: 1,
    });

    const result = await checkIngressStatus(clusterId, { force: true });

    expect(result.status).toBe("unknown");
  });

  // Killed by a signal (code null) or OOM (137): no stderr, so no errors either.
  it.each([
    ["killed by a signal", null],
    ["killed by the OOM killer", 137],
  ])("returns unknown, not an empty cluster, when kubectl was %s", async (_, code) => {
    mockedKubectl.mockResolvedValue({ output: "", errors: "", code } as never);

    const result = await checkIngressStatus(clusterId, { force: true });

    expect(result.status).toBe("unknown");
  });

  it("returns unknown on thrown error", async () => {
    mockedKubectl.mockRejectedValue(new Error("network failure"));

    const result = await checkIngressStatus(clusterId, { force: true });

    expect(result.status).toBe("unknown");
  });
});
