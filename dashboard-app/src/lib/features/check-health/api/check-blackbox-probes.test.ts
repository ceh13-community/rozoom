import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkBlackboxProbes } from "./check-blackbox-probes";
import { resetFeatureCapabilityCache } from "../model/feature-capability-cache";

const { kubectlRawFrontMock, logErrorMock, queryInstantMock } = vi.hoisted(() => ({
  kubectlRawFrontMock: vi.fn(),
  logErrorMock: vi.fn(),
  queryInstantMock: vi.fn(),
}));

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawFront: kubectlRawFrontMock,
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  error: logErrorMock,
}));

vi.mock("./resolvers/prometheus-client", () => ({
  PrometheusClient: class {
    queryInstant = queryInstantMock;
  },
}));

describe("checkBlackboxProbes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFeatureCapabilityCache();
  });

  it("skips repeated probe queries after a blackbox metrics failure", async () => {
    kubectlRawFrontMock
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [
            {
              metadata: { name: "public", namespace: "default" },
              spec: { rules: [{ host: "example.com" }] },
            },
          ],
        }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({ items: [] }),
        errors: "",
      });
    queryInstantMock.mockRejectedValueOnce(new Error("Prometheus query HTTP 400"));

    const first = await checkBlackboxProbes("cluster-a", { force: true });
    const second = await checkBlackboxProbes("cluster-a");

    expect(first.errors).toBe("Prometheus query HTTP 400");
    expect(second.errors).toBe("Prometheus query HTTP 400");
    expect(queryInstantMock).toHaveBeenCalledTimes(3);
    expect(kubectlRawFrontMock).toHaveBeenCalledTimes(2);
    expect(logErrorMock).toHaveBeenCalledWith(
      "Blackbox probe metrics fetch failed: Prometheus query HTTP 400",
    );
  });
});
