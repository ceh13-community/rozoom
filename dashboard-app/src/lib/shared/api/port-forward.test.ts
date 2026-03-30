import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startPortForward, stopPortForward } from "./port-forward";
import * as tauriPath from "@tauri-apps/api/path";
import * as cli from "$shared/api/cli";
import {
  getPortForwardTelemetrySnapshot,
  resetPortForwardTelemetry,
} from "$shared/lib/port-forward-telemetry";
import type { Child, Command, IOPayload } from "@tauri-apps/plugin-shell";

vi.mock("@tauri-apps/api/path");
vi.mock("@/lib/shared/api/cli");

describe("port-forward", () => {
  const mockAppDataDir = "/mock/app/data";
  const mockClusterId = "test-cluster-123";
  const mockNamespace = "monitoring";
  const mockResource = "pod/node-exporter-abc";
  const mockUniqueKey = "test-forward-key";

  let mockChild: Child;
  let mockCommand: Command<IOPayload>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetPortForwardTelemetry();

    mockChild = {
      kill: vi.fn().mockResolvedValue(undefined),
      pid: 12345,
      write: vi.fn(),
    } as unknown as Child;

    mockCommand = {} as Command<IOPayload>;

    vi.mocked(tauriPath.appDataDir).mockResolvedValue(mockAppDataDir);
  });

  afterEach(async () => {
    await stopPortForward(mockUniqueKey);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("startPortForward", () => {
    it("should start port-forward successfully", async () => {
      vi.useRealTimers(); // Use real timers for this test

      let onStdoutLine: ((line: string) => void) | undefined;

      vi.mocked(cli.spawnCli).mockImplementation(async (tool, args, handlers) => {
        onStdoutLine = handlers?.onStdoutLine;

        // Simulate kubectl output after a small delay
        setTimeout(() => {
          onStdoutLine?.("Forwarding from 127.0.0.1:19100 -> 9100");
        }, 100);

        return { command: mockCommand, child: mockChild };
      });

      const result = await startPortForward({
        namespace: mockNamespace,
        resource: mockResource,
        remotePort: 9100,
        localPort: 19100,
        clusterId: mockClusterId,
        uniqueKey: mockUniqueKey,
      });

      expect(result).toEqual({ success: true });
      expect(cli.spawnCli).toHaveBeenCalledWith(
        "kubectl",
        [
          "port-forward",
          "-n",
          mockNamespace,
          mockResource,
          "19100:9100",
          "--kubeconfig",
          `${mockAppDataDir}/configs/${mockClusterId}.yaml`,
          "--address",
          "127.0.0.1",
          "--v=2",
        ],
        expect.objectContaining({
          onStdoutLine: expect.any(Function),
          onStderrLine: expect.any(Function),
          onClose: expect.any(Function),
          onError: expect.any(Function),
        }),
      );

      vi.useFakeTimers(); // Restore fake timers
    });

    it("should use remotePort as localPort when localPort not provided", async () => {
      vi.useRealTimers();

      let onStdoutLine: ((line: string) => void) | undefined;

      vi.mocked(cli.spawnCli).mockImplementation(async (tool, args, handlers) => {
        onStdoutLine = handlers?.onStdoutLine;

        setTimeout(() => {
          onStdoutLine?.("Forwarding from 127.0.0.1:9100 -> 9100");
        }, 100); // Increased delay

        return { command: mockCommand, child: mockChild };
      });

      const result = await startPortForward({
        namespace: mockNamespace,
        resource: mockResource,
        remotePort: 9100,
        clusterId: mockClusterId,
        uniqueKey: mockUniqueKey,
      });

      expect(result.success).toBe(true);
      expect(cli.spawnCli).toHaveBeenCalledWith(
        "kubectl",
        expect.arrayContaining(["9100:9100"]),
        expect.any(Object),
      );

      vi.useFakeTimers();
    });

    it("should return error when port-forward already running", async () => {
      let onStdoutLine: ((line: string) => void) | undefined;

      vi.mocked(cli.spawnCli).mockImplementation(async (tool, args, handlers) => {
        onStdoutLine = handlers?.onStdoutLine;
        return { command: mockCommand, child: mockChild };
      });

      // Start first port-forward
      const firstPromise = startPortForward({
        namespace: mockNamespace,
        resource: mockResource,
        remotePort: 9100,
        clusterId: mockClusterId,
        uniqueKey: mockUniqueKey,
      });

      await vi.advanceTimersByTimeAsync(100);
      onStdoutLine?.("Forwarding from 127.0.0.1:9100 -> 9100");
      await vi.advanceTimersByTimeAsync(100);

      await firstPromise;

      // Try to start again with same key
      const result = await startPortForward({
        namespace: mockNamespace,
        resource: mockResource,
        remotePort: 9100,
        clusterId: mockClusterId,
        uniqueKey: mockUniqueKey,
      });

      expect(result).toEqual({
        success: false,
        error: "Port-forward already running for this key",
      });
    });

    it("should return error when timeout waiting for ready", async () => {
      vi.mocked(cli.spawnCli).mockResolvedValue({
        command: mockCommand,
        child: mockChild,
      });

      const startPromise = startPortForward({
        namespace: mockNamespace,
        resource: mockResource,
        remotePort: 9100,
        clusterId: mockClusterId,
        uniqueKey: mockUniqueKey,
      });

      // Don't send "Forwarding from" message, let it timeout
      await vi.advanceTimersByTimeAsync(5100);

      const result = await startPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain("Port-forward not ready (timeout)");
      expect(mockChild.kill).toHaveBeenCalledTimes(1);
    });

    it("should reject when local port is already used by another running forward", async () => {
      let onStdoutLine: ((line: string) => void) | undefined;

      vi.mocked(cli.spawnCli).mockImplementation(async (_tool, _args, handlers) => {
        onStdoutLine = handlers?.onStdoutLine;
        return { command: mockCommand, child: mockChild };
      });

      const first = startPortForward({
        namespace: mockNamespace,
        resource: "svc/first",
        remotePort: 9100,
        localPort: 19090,
        clusterId: mockClusterId,
        uniqueKey: "key-1",
      });
      await vi.advanceTimersByTimeAsync(100);
      onStdoutLine?.("Forwarding from 127.0.0.1:19090 -> 9100");
      await vi.advanceTimersByTimeAsync(100);
      await first;

      const second = await startPortForward({
        namespace: "other",
        resource: "svc/second",
        remotePort: 9200,
        localPort: 19090,
        clusterId: mockClusterId,
        uniqueKey: "key-2",
      });

      expect(second).toEqual({
        success: false,
        error: "Local port 19090 is already in use by another running port-forward.",
      });
      await stopPortForward("key-1");
    });

    it("prevents concurrent start race on the same local port", async () => {
      let onFirstStdoutLine: ((line: string) => void) | undefined;
      let resolveFirstSpawn: (() => void) | undefined;

      vi.mocked(cli.spawnCli).mockImplementationOnce(
        async (_tool, _args, handlers) =>
          await new Promise((resolve) => {
            onFirstStdoutLine = handlers?.onStdoutLine;
            resolveFirstSpawn = () => resolve({ command: mockCommand, child: mockChild });
          }),
      );

      const firstPromise = startPortForward({
        namespace: mockNamespace,
        resource: "svc/first",
        remotePort: 9100,
        localPort: 19123,
        clusterId: mockClusterId,
        uniqueKey: "race-key-1",
      });

      await Promise.resolve();
      const second = await startPortForward({
        namespace: "other",
        resource: "svc/second",
        remotePort: 9200,
        localPort: 19123,
        clusterId: mockClusterId,
        uniqueKey: "race-key-2",
      });

      expect(second).toEqual({
        success: false,
        error: "Local port 19123 is already in use by another running port-forward.",
      });
      expect(cli.spawnCli).toHaveBeenCalledTimes(1);

      resolveFirstSpawn?.();
      await vi.advanceTimersByTimeAsync(100);
      onFirstStdoutLine?.("Forwarding from 127.0.0.1:19123 -> 9100");
      await vi.advanceTimersByTimeAsync(100);

      const first = await firstPromise;
      expect(first.success).toBe(true);
      await stopPortForward("race-key-1");
    });

    it("should include stderr error in timeout message", async () => {
      let onStderrLine: ((line: string) => void) | undefined;

      vi.mocked(cli.spawnCli).mockImplementation(async (tool, args, handlers) => {
        onStderrLine = handlers?.onStderrLine;
        return { command: mockCommand, child: mockChild };
      });

      const startPromise = startPortForward({
        namespace: mockNamespace,
        resource: mockResource,
        remotePort: 9100,
        clusterId: mockClusterId,
        uniqueKey: mockUniqueKey,
      });

      await vi.advanceTimersByTimeAsync(100);
      onStderrLine?.("Error: unable to forward port");
      await vi.advanceTimersByTimeAsync(5000);

      const result = await startPromise;

      expect(result.success).toBe(false);
      expect(result.error).toBe("Error: unable to forward port");
    });

    it("should handle spawnCli throwing error", async () => {
      vi.mocked(cli.spawnCli).mockRejectedValue(new Error("Failed to spawn"));

      const result = await startPortForward({
        namespace: mockNamespace,
        resource: mockResource,
        remotePort: 9100,
        clusterId: mockClusterId,
        uniqueKey: mockUniqueKey,
      });

      expect(result).toEqual({
        success: false,
        error: "Failed to spawn",
      });
    });

    it("should handle non-Error exceptions", async () => {
      vi.mocked(cli.spawnCli).mockRejectedValue("String error");

      const result = await startPortForward({
        namespace: mockNamespace,
        resource: mockResource,
        remotePort: 9100,
        clusterId: mockClusterId,
        uniqueKey: mockUniqueKey,
      });

      expect(result).toEqual({
        success: false,
        error: "Unknown error",
      });
    });

    it("should mark process as not running when closed", async () => {
      let onStdoutLine: ((line: string) => void) | undefined;
      let onClose: ((e: unknown) => void) | undefined;

      vi.mocked(cli.spawnCli).mockImplementation(async (tool, args, handlers) => {
        onStdoutLine = handlers?.onStdoutLine;
        onClose = handlers?.onClose;
        return { command: mockCommand, child: mockChild };
      });

      const startPromise = startPortForward({
        namespace: mockNamespace,
        resource: mockResource,
        remotePort: 9100,
        clusterId: mockClusterId,
        uniqueKey: mockUniqueKey,
      });

      await vi.advanceTimersByTimeAsync(100);
      onStdoutLine?.("Forwarding from 127.0.0.1:9100 -> 9100");
      await vi.advanceTimersByTimeAsync(100);

      await startPromise;

      // Simulate process close
      onClose?.({ code: 0 });

      // Should be able to start again now
      const secondAttempt = startPortForward({
        namespace: mockNamespace,
        resource: mockResource,
        remotePort: 9100,
        clusterId: mockClusterId,
        uniqueKey: mockUniqueKey,
      });

      await vi.advanceTimersByTimeAsync(100);
      onStdoutLine?.("Forwarding from 127.0.0.1:9100 -> 9100");
      await vi.advanceTimersByTimeAsync(100);

      const result = await secondAttempt;

      expect(result.success).toBe(true);
    });

    it("should construct correct kubeconfig path", async () => {
      let onStdoutLine: ((line: string) => void) | undefined;

      vi.mocked(cli.spawnCli).mockImplementation(async (tool, args, handlers) => {
        onStdoutLine = handlers?.onStdoutLine;
        return { command: mockCommand, child: mockChild };
      });

      const startPromise = startPortForward({
        namespace: "custom-ns",
        resource: "svc/my-service",
        remotePort: 8080,
        localPort: 18080,
        clusterId: "cluster-xyz",
        uniqueKey: "custom-key",
      });

      await vi.advanceTimersByTimeAsync(100);
      onStdoutLine?.("Forwarding from 127.0.0.1:18080 -> 8080");
      await vi.advanceTimersByTimeAsync(100);

      await startPromise;

      expect(cli.spawnCli).toHaveBeenCalledWith(
        "kubectl",
        expect.arrayContaining(["--kubeconfig", `${mockAppDataDir}/configs/cluster-xyz.yaml`]),
        expect.any(Object),
      );
    });

    it("tracks telemetry for start/duplicate/stop lifecycle", async () => {
      let onStdoutLine: ((line: string) => void) | undefined;

      vi.mocked(cli.spawnCli).mockImplementation(async (_tool, _args, handlers) => {
        onStdoutLine = handlers?.onStdoutLine;
        return { command: mockCommand, child: mockChild };
      });

      const firstPromise = startPortForward({
        namespace: mockNamespace,
        resource: mockResource,
        remotePort: 9100,
        clusterId: mockClusterId,
        uniqueKey: mockUniqueKey,
      });

      await vi.advanceTimersByTimeAsync(100);
      onStdoutLine?.("Forwarding from 127.0.0.1:9100 -> 9100");
      await vi.advanceTimersByTimeAsync(100);
      await firstPromise;

      const duplicate = await startPortForward({
        namespace: mockNamespace,
        resource: mockResource,
        remotePort: 9100,
        clusterId: mockClusterId,
        uniqueKey: mockUniqueKey,
      });

      expect(duplicate.success).toBe(false);

      await stopPortForward(mockUniqueKey);

      expect(getPortForwardTelemetrySnapshot()).toEqual({
        startAttempts: 2,
        startSuccesses: 1,
        startFailures: 1,
        stopAttempts: 1,
        stopSuccesses: 1,
        stopFailures: 0,
        timeoutFailures: 0,
      });
    });
  });

  describe("stopPortForward", () => {
    // it("should stop running port-forward", async () => {
    //   let onStdoutLine: ((line: string) => void) | undefined;

    //   vi.mocked(cli.spawnCli).mockImplementation(async (tool, args, handlers) => {
    //     onStdoutLine = handlers?.onStdoutLine;
    //     return { command: mockCommand, child: mockChild };
    //   });

    //   // Start port-forward
    //   const startPromise = startPortForward({
    //     namespace: mockNamespace,
    //     resource: mockResource,
    //     remotePort: 9100,
    //     clusterId: mockClusterId,
    //     uniqueKey: mockUniqueKey,
    //   });

    //   await vi.advanceTimersByTimeAsync(100);
    //   onStdoutLine?.("Forwarding from 127.0.0.1:9100 -> 9100");
    //   await vi.advanceTimersByTimeAsync(100);

    //   await startPromise;

    //   // Stop port-forward
    //   await stopPortForward(mockUniqueKey);

    //   expect(mockChild.kill).toHaveBeenCalled();
    // });

    // it("should do nothing when port-forward not running", async () => {
    //   await stopPortForward("non-existent-key");

    //   expect(mockChild.kill).not.toHaveBeenCalled();
    // });

    it("should do nothing when port-forward was already stopped", async () => {
      let onStdoutLine: ((line: string) => void) | undefined;
      let onClose: ((e: unknown) => void) | undefined;

      vi.mocked(cli.spawnCli).mockImplementation(async (tool, args, handlers) => {
        onStdoutLine = handlers?.onStdoutLine;
        onClose = handlers?.onClose;
        return { command: mockCommand, child: mockChild };
      });

      // Start port-forward
      const startPromise = startPortForward({
        namespace: mockNamespace,
        resource: mockResource,
        remotePort: 9100,
        clusterId: mockClusterId,
        uniqueKey: mockUniqueKey,
      });

      await vi.advanceTimersByTimeAsync(100);
      onStdoutLine?.("Forwarding from 127.0.0.1:9100 -> 9100");
      await vi.advanceTimersByTimeAsync(100);

      await startPromise;

      // Simulate process close
      onClose?.({ code: 0 });

      vi.mocked(mockChild.kill).mockClear();

      // Try to stop
      await stopPortForward(mockUniqueKey);

      expect(mockChild.kill).not.toHaveBeenCalled();
    });

    // it("should remove process from active forwards even if kill throws", async () => {
    //   let onStdoutLine: ((line: string) => void) | undefined;

    //   vi.mocked(cli.spawnCli).mockImplementation(async (tool, args, handlers) => {
    //     onStdoutLine = handlers?.onStdoutLine;
    //     return { command: mockCommand, child: mockChild };
    //   });

    //   // Start port-forward
    //   const startPromise = startPortForward({
    //     namespace: mockNamespace,
    //     resource: mockResource,
    //     remotePort: 9100,
    //     clusterId: mockClusterId,
    //     uniqueKey: mockUniqueKey,
    //   });

    //   await vi.advanceTimersByTimeAsync(100);
    //   onStdoutLine?.("Forwarding from 127.0.0.1:9100 -> 9100");
    //   await vi.advanceTimersByTimeAsync(100);

    //   await startPromise;

    //   // Make kill throw
    //   vi.mocked(mockChild.kill).mockRejectedValue(new Error("Kill failed"));

    //   // Stop should not throw
    //   await expect(stopPortForward(mockUniqueKey)).resolves.toBeUndefined();

    //   // Should still be removed, so starting again should work
    //   vi.mocked(mockChild.kill).mockResolvedValue(undefined);

    //   const secondAttempt = startPortForward({
    //     namespace: mockNamespace,
    //     resource: mockResource,
    //     remotePort: 9100,
    //     clusterId: mockClusterId,
    //     uniqueKey: mockUniqueKey,
    //   });

    //   await vi.advanceTimersByTimeAsync(100);
    //   onStdoutLine?.("Forwarding from 127.0.0.1:9100 -> 9100");
    //   await vi.advanceTimersByTimeAsync(100);

    //   const result = await secondAttempt;

    //   expect(result.success).toBe(true);
    // });

    it("should allow restarting after stop", async () => {
      let onStdoutLine: ((line: string) => void) | undefined;

      vi.mocked(cli.spawnCli).mockImplementation(async (tool, args, handlers) => {
        onStdoutLine = handlers?.onStdoutLine;
        return { command: mockCommand, child: mockChild };
      });

      // Start
      const startPromise1 = startPortForward({
        namespace: mockNamespace,
        resource: mockResource,
        remotePort: 9100,
        clusterId: mockClusterId,
        uniqueKey: mockUniqueKey,
      });

      await vi.advanceTimersByTimeAsync(100);
      onStdoutLine?.("Forwarding from 127.0.0.1:9100 -> 9100");
      await vi.advanceTimersByTimeAsync(100);

      await startPromise1;

      // Stop
      await stopPortForward(mockUniqueKey);

      // Start again
      const startPromise2 = startPortForward({
        namespace: mockNamespace,
        resource: mockResource,
        remotePort: 9100,
        clusterId: mockClusterId,
        uniqueKey: mockUniqueKey,
      });

      await vi.advanceTimersByTimeAsync(100);
      onStdoutLine?.("Forwarding from 127.0.0.1:9100 -> 9100");
      await vi.advanceTimersByTimeAsync(100);

      const result = await startPromise2;

      expect(result.success).toBe(true);
    });
  });

  describe("multiple port-forwards", () => {
    it("should handle multiple port-forwards with different keys", async () => {
      let onStdoutLine: ((line: string) => void) | undefined;

      vi.mocked(cli.spawnCli).mockImplementation(async (tool, args, handlers) => {
        onStdoutLine = handlers?.onStdoutLine;
        return { command: mockCommand, child: mockChild };
      });

      // Start first
      const promise1 = startPortForward({
        namespace: mockNamespace,
        resource: mockResource,
        remotePort: 9100,
        clusterId: mockClusterId,
        uniqueKey: "key-1",
      });

      await vi.advanceTimersByTimeAsync(100);
      onStdoutLine?.("Forwarding from 127.0.0.1:9100 -> 9100");
      await vi.advanceTimersByTimeAsync(100);

      const result1 = await promise1;

      // Start second
      const promise2 = startPortForward({
        namespace: "other-ns",
        resource: "svc/other-service",
        remotePort: 8080,
        clusterId: mockClusterId,
        uniqueKey: "key-2",
      });

      await vi.advanceTimersByTimeAsync(100);
      onStdoutLine?.("Forwarding from 127.0.0.1:8080 -> 8080");
      await vi.advanceTimersByTimeAsync(100);

      const result2 = await promise2;

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });
  });
});
