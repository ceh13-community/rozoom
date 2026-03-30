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

  it("returns unknown when no ingresses found", async () => {
    mockedKubectl.mockResolvedValue({
      output: "",
      errors: "",
      code: 0,
    });

    const result = await checkIngressStatus(clusterId, { force: true });

    expect(result.status).toBe("unknown");
    expect(result.summary.total).toBe(0);
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

  it("returns unknown on thrown error", async () => {
    mockedKubectl.mockRejectedValue(new Error("network failure"));

    const result = await checkIngressStatus(clusterId, { force: true });

    expect(result.status).toBe("unknown");
  });
});
