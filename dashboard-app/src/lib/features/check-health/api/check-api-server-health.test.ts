import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
}));

vi.mock("@/lib/shared/api/kubectl-proxy", () => ({
  kubectlRawFront: vi.fn(),
}));

import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { checkApiServerHealth } from "./check-api-server-health";

const mockedKubectl = vi.mocked(kubectlRawFront);

describe("checkApiServerHealth", () => {
  const clusterId = "cluster-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok when both livez and readyz pass", async () => {
    mockedKubectl.mockResolvedValue({
      output: "ok",
      errors: "",
      code: 0,
    });

    const result = await checkApiServerHealth(clusterId);

    expect(result.status).toBe("ok");
    expect(result.live.ok).toBe(true);
    expect(result.ready.ok).toBe(true);
    expect(result.updatedAt).toBeGreaterThan(0);
  });

  it("returns ok when output contains 'check passed'", async () => {
    mockedKubectl.mockResolvedValue({
      output: "[+] etcd ok\ncheck passed",
      errors: "",
      code: 0,
    });

    const result = await checkApiServerHealth(clusterId);

    expect(result.status).toBe("ok");
    expect(result.live.ok).toBe(true);
    expect(result.ready.ok).toBe(true);
  });

  it("returns critical when livez fails", async () => {
    mockedKubectl
      .mockResolvedValueOnce({
        output: "",
        errors: "connection refused",
        code: 1,
      })
      .mockResolvedValueOnce({
        output: "ok",
        errors: "",
        code: 0,
      });

    const result = await checkApiServerHealth(clusterId);

    expect(result.status).toBe("critical");
    expect(result.live.ok).toBe(false);
    expect(result.live.error).toBeDefined();
    expect(result.ready.ok).toBe(true);
  });

  it("returns warning when readyz fails but livez passes", async () => {
    mockedKubectl
      .mockResolvedValueOnce({
        output: "ok",
        errors: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        output: "readyz check failed",
        errors: "not ready",
        code: 1,
      });

    const result = await checkApiServerHealth(clusterId);

    expect(result.status).toBe("warning");
    expect(result.live.ok).toBe(true);
    expect(result.ready.ok).toBe(false);
    expect(result.ready.error).toBeDefined();
  });

  it("returns critical when both endpoints fail", async () => {
    mockedKubectl.mockResolvedValue({
      output: "",
      errors: "connection refused",
      code: 1,
    });

    const result = await checkApiServerHealth(clusterId);

    expect(result.status).toBe("critical");
    expect(result.live.ok).toBe(false);
    expect(result.ready.ok).toBe(false);
  });

  it("sets error to 'Unreachable' when output and errors are empty", async () => {
    mockedKubectl.mockResolvedValue({
      output: "",
      errors: "",
      code: 1,
    });

    const result = await checkApiServerHealth(clusterId);

    expect(result.status).toBe("critical");
    expect(result.live.error).toBe("Unreachable");
  });

  it("does not treat non-zero exit code with 'ok' output as failure", async () => {
    mockedKubectl.mockResolvedValue({
      output: "something else entirely",
      errors: "",
      code: 1,
    });

    const result = await checkApiServerHealth(clusterId);

    expect(result.live.ok).toBe(false);
    expect(result.ready.ok).toBe(false);
  });
});
