import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PrometheusClient } from "./prometheus-client";
import * as tauriHttp from "@tauri-apps/plugin-http";
import * as portForward from "$shared/api/port-forward";
import * as discoverPrometheus from "$shared/api/discover-prometheus";
import type { PrometheusTarget } from "$shared/api/discover-prometheus";

vi.mock("@tauri-apps/plugin-http");
vi.mock("@/lib/shared/api/port-forward");
vi.mock("@/lib/shared/api/discover-prometheus");

describe("PrometheusClient", () => {
  const mockClusterId = "test-cluster-123";
  const mockTarget: PrometheusTarget = {
    name: "prometheus-server",
    namespace: "monitoring",
    port: 9090,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("should create instance with clusterId", () => {
      const client = new PrometheusClient(mockClusterId);
      expect(client).toBeInstanceOf(PrometheusClient);
    });
  });

  describe("discover", () => {
    it("should discover prometheus service and store target", async () => {
      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue(mockTarget);

      const client = new PrometheusClient(mockClusterId);
      const result = await client.discover();

      expect(result).toEqual(mockTarget);
      expect(discoverPrometheus.discoverPrometheusService).toHaveBeenCalledWith(mockClusterId);
    });

    it("should return null when prometheus not found", async () => {
      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue(null);

      const client = new PrometheusClient(mockClusterId);
      const result = await client.discover();

      expect(result).toBeNull();
    });

    it("should update internal target state", async () => {
      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue(mockTarget);

      const client = new PrometheusClient(mockClusterId);
      await client.discover();

      vi.mocked(portForward.startPortForward).mockResolvedValue({ success: true });
      vi.mocked(tauriHttp.fetch)
        .mockResolvedValueOnce({ ok: true } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: "success",
            data: { result: [] },
          }),
        } as unknown as Response);
      vi.mocked(portForward.stopPortForward).mockResolvedValue(undefined);

      const advanceTimers = async () => {
        await vi.advanceTimersByTimeAsync(300);
      };

      const queryPromise = client.queryInstant("up");
      await advanceTimers();
      await queryPromise;

      expect(discoverPrometheus.discoverPrometheusService).toHaveBeenCalledTimes(1);
    });
  });

  describe("queryInstant", () => {
    it("should execute prometheus query successfully", async () => {
      const mockResult = [
        {
          metric: { __name__: "up", job: "prometheus" },
          value: [1234567890, "1"],
        },
      ];

      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue(mockTarget);
      vi.mocked(portForward.startPortForward).mockResolvedValue({ success: true });
      vi.mocked(tauriHttp.fetch)
        .mockResolvedValueOnce({ ok: true } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: "success",
            data: { result: mockResult },
          }),
        } as unknown as Response);
      vi.mocked(portForward.stopPortForward).mockResolvedValue(undefined);

      const client = new PrometheusClient(mockClusterId);
      const queryPromise = client.queryInstant("up");

      await vi.advanceTimersByTimeAsync(300);

      const result = await queryPromise;

      expect(result).toEqual(mockResult);
      expect(portForward.stopPortForward).toHaveBeenCalled();
    });

    it("should discover prometheus if target not set", async () => {
      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue(mockTarget);
      vi.mocked(portForward.startPortForward).mockResolvedValue({ success: true });
      vi.mocked(tauriHttp.fetch)
        .mockResolvedValueOnce({ ok: true } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: "success",
            data: { result: [] },
          }),
        } as unknown as Response);
      vi.mocked(portForward.stopPortForward).mockResolvedValue(undefined);

      const client = new PrometheusClient(mockClusterId);
      const queryPromise = client.queryInstant("test_metric");

      await vi.advanceTimersByTimeAsync(300);

      await queryPromise;

      expect(discoverPrometheus.discoverPrometheusService).toHaveBeenCalled();
    });

    it("should throw error when prometheus service not found", async () => {
      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue(null);

      const client = new PrometheusClient(mockClusterId);

      let error: Error | undefined;
      try {
        await client.queryInstant("up");
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain("Prometheus service not found");
    });

    it("should throw error when port-forward fails", async () => {
      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue(mockTarget);
      vi.mocked(portForward.startPortForward).mockResolvedValue({
        success: false,
        error: "Port already in use",
      });
      vi.mocked(portForward.stopPortForward).mockResolvedValue(undefined);

      const client = new PrometheusClient(mockClusterId);

      let error: Error | undefined;
      try {
        await client.queryInstant("up");
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain("Port already in use");
    });

    it("should throw error when port-forward fails without error message", async () => {
      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue(mockTarget);
      vi.mocked(portForward.startPortForward).mockResolvedValue({
        success: false,
      });
      vi.mocked(portForward.stopPortForward).mockResolvedValue(undefined);

      const client = new PrometheusClient(mockClusterId);

      let error: Error | undefined;
      try {
        await client.queryInstant("up");
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain("Port-forward failed");
    });

    it("should wait for prometheus to be ready", async () => {
      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue(mockTarget);
      vi.mocked(portForward.startPortForward).mockResolvedValue({ success: true });

      let readyCallCount = 0;
      vi.mocked(tauriHttp.fetch).mockImplementation(async (url) => {
        if (typeof url === "string" && url.includes("/-/ready")) {
          readyCallCount++;
          if (readyCallCount < 3) {
            throw new Error("Not ready yet");
          }
          return { ok: true } as Response;
        }
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: "success",
            data: { result: [] },
          }),
        } as unknown as Response;
      });

      vi.mocked(portForward.stopPortForward).mockResolvedValue(undefined);

      const client = new PrometheusClient(mockClusterId);
      const queryPromise = client.queryInstant("up");

      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(300);

      await queryPromise;

      expect(readyCallCount).toBe(3);
    });

    it("should encode query parameter correctly", async () => {
      const query = 'rate(http_requests_total{job="api"}[5m])';

      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue(mockTarget);
      vi.mocked(portForward.startPortForward).mockResolvedValue({ success: true });

      let capturedUrl = "";
      vi.mocked(tauriHttp.fetch).mockImplementation(async (url) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/api/v1/query")) {
          capturedUrl = urlStr;
        }
        if (urlStr.includes("/-/ready")) {
          return { ok: true } as Response;
        }
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: "success",
            data: { result: [] },
          }),
        } as unknown as Response;
      });

      vi.mocked(portForward.stopPortForward).mockResolvedValue(undefined);

      const client = new PrometheusClient(mockClusterId);
      const queryPromise = client.queryInstant(query);

      await vi.advanceTimersByTimeAsync(300);
      await queryPromise;

      expect(capturedUrl).toContain(encodeURIComponent(query));
    });

    it("should handle stopPortForward failure gracefully", async () => {
      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue(mockTarget);
      vi.mocked(portForward.startPortForward).mockResolvedValue({ success: true });
      vi.mocked(tauriHttp.fetch)
        .mockResolvedValueOnce({ ok: true } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: "success",
            data: { result: [] },
          }),
        } as unknown as Response);
      vi.mocked(portForward.stopPortForward).mockRejectedValue(new Error("Stop failed"));

      const client = new PrometheusClient(mockClusterId);
      const queryPromise = client.queryInstant("up");

      await vi.advanceTimersByTimeAsync(300);

      await expect(queryPromise).resolves.toEqual([]);
    });

    it("should use unique key for port-forward", async () => {
      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue(mockTarget);
      vi.mocked(portForward.startPortForward).mockResolvedValue({ success: true });
      vi.mocked(tauriHttp.fetch)
        .mockResolvedValueOnce({ ok: true } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: "success",
            data: { result: [] },
          }),
        } as unknown as Response);
      vi.mocked(portForward.stopPortForward).mockResolvedValue(undefined);

      const client = new PrometheusClient(mockClusterId);
      const queryPromise = client.queryInstant("up");

      await vi.advanceTimersByTimeAsync(300);
      await queryPromise;

      expect(portForward.startPortForward).toHaveBeenCalledWith(
        expect.objectContaining({
          uniqueKey: expect.stringContaining("prom-"),
          namespace: mockTarget.namespace,
          resource: `svc/${mockTarget.name}`,
          remotePort: mockTarget.port,
          clusterId: mockClusterId,
        }),
      );

      const startCall = vi.mocked(portForward.startPortForward).mock.calls[0][0];
      const stopCall = vi.mocked(portForward.stopPortForward).mock.calls[0][0];

      expect(stopCall).toBe(startCall.uniqueKey);
    });

    it("should handle matrix result type", async () => {
      const mockResult = [
        {
          metric: { __name__: "cpu_usage" },
          values: [
            [1234567890, "0.5"],
            [1234567891, "0.6"],
          ],
        },
      ];

      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue(mockTarget);
      vi.mocked(portForward.startPortForward).mockResolvedValue({ success: true });
      vi.mocked(tauriHttp.fetch)
        .mockResolvedValueOnce({ ok: true } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: "success",
            data: { resultType: "matrix", result: mockResult },
          }),
        } as unknown as Response);
      vi.mocked(portForward.stopPortForward).mockResolvedValue(undefined);

      const client = new PrometheusClient(mockClusterId);
      const queryPromise = client.queryInstant("cpu_usage[5m]");

      await vi.advanceTimersByTimeAsync(300);

      const result = await queryPromise;

      expect(result).toEqual(mockResult);
    });

    it("should handle empty result", async () => {
      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue(mockTarget);
      vi.mocked(portForward.startPortForward).mockResolvedValue({ success: true });
      vi.mocked(tauriHttp.fetch)
        .mockResolvedValueOnce({ ok: true } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: "success",
            data: { result: [] },
          }),
        } as unknown as Response);
      vi.mocked(portForward.stopPortForward).mockResolvedValue(undefined);

      const client = new PrometheusClient(mockClusterId);
      const queryPromise = client.queryInstant("nonexistent_metric");

      await vi.advanceTimersByTimeAsync(300);

      const result = await queryPromise;

      expect(result).toEqual([]);
    });
  });
});
