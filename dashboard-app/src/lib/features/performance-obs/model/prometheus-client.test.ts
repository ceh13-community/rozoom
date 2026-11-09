import { beforeEach, describe, expect, it, vi } from "vitest";
import * as kubectlProxy from "$shared/api/kubectl-proxy";
import { extractScalars, instantQuery } from "./prometheus-client";

vi.mock("$shared/api/kubectl-proxy");

describe("instantQuery", () => {
  const endpoint = {
    namespace: "monitoring",
    service: "prometheus-k8s",
    port: 9090,
    flavor: "kube-prometheus-stack" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the proxy path to --raw unquoted and URL-encoded as one argument", async () => {
    vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue({
      status: "success",
      data: { resultType: "vector", result: [] },
    });

    const result = await instantQuery(
      "cluster-1",
      endpoint,
      'sum(rate(http_requests_total{job="api"}[5m]))',
    );

    expect(result?.status).toBe("success");
    expect(kubectlProxy.kubectlJson).toHaveBeenCalledTimes(1);
    const [cmd, options] = vi.mocked(kubectlProxy.kubectlJson).mock.calls[0];
    expect(options).toEqual({ clusterId: "cluster-1" });
    expect(cmd).toMatch(
      /^get --raw=\/api\/v1\/namespaces\/monitoring\/services\/prometheus-k8s:9090\/proxy\/api\/v1\/query\?query=\S+ --request-timeout=15s$/,
    );
    expect(cmd).not.toMatch(/["']/);
  });

  it("returns null when kubectl reports an error string", async () => {
    vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue("kubectl error");

    expect(await instantQuery("cluster-1", endpoint, "up")).toBeNull();
  });
});

describe("extractScalars", () => {
  it("returns empty array for null input (query failed)", () => {
    expect(extractScalars(null, ["pod"])).toEqual([]);
  });

  it("returns empty array when data.result is missing", () => {
    expect(extractScalars({ status: "success", data: {} }, ["pod"])).toEqual([]);
  });

  it("parses numeric sample values from each series", () => {
    const result = extractScalars(
      {
        status: "success",
        data: {
          resultType: "vector",
          result: [
            {
              metric: { pod: "web-1", container: "app" },
              value: [1700000000, "12.5"],
            },
            {
              metric: { pod: "web-2", container: "app" },
              value: [1700000000, "7.2"],
            },
          ],
        },
      },
      ["pod", "container"],
    );
    expect(result).toEqual([
      { key: "web-1/app", tags: { pod: "web-1", container: "app" }, value: 12.5 },
      { key: "web-2/app", tags: { pod: "web-2", container: "app" }, value: 7.2 },
    ]);
  });

  it("skips series without a value field", () => {
    const result = extractScalars(
      {
        status: "success",
        data: { result: [{ metric: { pod: "x" } }] },
      },
      ["pod"],
    );
    expect(result).toEqual([]);
  });

  it("skips series with non-numeric values (NaN)", () => {
    const result = extractScalars(
      {
        status: "success",
        data: { result: [{ metric: { pod: "x" }, value: [0, "NaN"] }] },
      },
      ["pod"],
    );
    expect(result).toEqual([]);
  });

  it("fills missing labels with empty string and '-' in the key", () => {
    const result = extractScalars(
      {
        status: "success",
        data: { result: [{ metric: { pod: "x" }, value: [0, "1"] }] },
      },
      ["pod", "namespace"],
    );
    expect(result[0]).toEqual({
      key: "x/-",
      tags: { pod: "x", namespace: "" },
      value: 1,
    });
  });
});
