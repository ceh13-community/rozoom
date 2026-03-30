import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkNodesHealth,
  getNodeMetricsDiagnostics,
  type NodeMetricsDiagnostics,
} from "./check-node-health";
import * as tauriApi from "$shared/api/tauri";
import * as logPlugin from "@tauri-apps/plugin-log";
import * as cpuRamResolver from "./resolvers/cpu-ram-resolver";
import * as diskResolver from "./resolvers/disk-resolver";

vi.mock("@/lib/shared/api/tauri");
vi.mock("@tauri-apps/plugin-log");
vi.mock("./resolvers/cpu-ram-resolver");
vi.mock("./resolvers/disk-resolver");

describe("checkNodesHealth", () => {
  let seq = 0;
  const clusterId = () => `cluster-a-${++seq}`;

  const baseDiagnostics: NodeMetricsDiagnostics = {
    checkedAt: "2026-02-22T00:00:00.000Z",
    sources: [],
    cpuMemory: {
      metric: "cpu_memory",
      resolvedFrom: "api",
      quality: "high",
      attempts: [],
      missingSources: [],
      recommendations: [],
    },
    disk: {
      metric: "disk",
      resolvedFrom: "node_exporter",
      quality: "high",
      attempts: [],
      missingSources: [],
      recommendations: [],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    vi.mocked(cpuRamResolver.resolveCpuRamWithTrace).mockResolvedValue({
      data: [
        { name: "node-1", cpu: "30%", memory: "40%" },
        { name: "node-2", cpu: "50%", memory: "60%" },
      ],
      trace: baseDiagnostics.cpuMemory,
      capabilities: [],
    });

    vi.mocked(diskResolver.resolveDiskWithTrace).mockResolvedValue({
      data: {
        "node-1": "100.00 GiB",
        "node-2": "200.00 GiB",
      },
      trace: baseDiagnostics.disk,
      capabilities: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns merged CPU/RAM and disk metrics", async () => {
    const result = await checkNodesHealth(clusterId());

    expect(result).toEqual([
      { name: "node-1", cpuUsage: "30%", memoryUsage: "40%", diskUsage: "100.00 GiB" },
      { name: "node-2", cpuUsage: "50%", memoryUsage: "60%", diskUsage: "200.00 GiB" },
    ]);
  });

  it("returns single node payload when nodeName is provided", async () => {
    vi.mocked(diskResolver.resolveDiskWithTrace).mockResolvedValueOnce({
      data: { "node-2": "200.00 GiB" },
      trace: baseDiagnostics.disk,
      capabilities: [],
    });

    const result = await checkNodesHealth(clusterId(), "node-2");

    expect(result).toEqual({
      name: "node-2",
      cpuUsage: "50%",
      memoryUsage: "60%",
      diskUsage: "200.00 GiB",
    });
  });

  it("falls back to cluster nodes list when cpu/memory is empty", async () => {
    const cid = clusterId();
    vi.mocked(cpuRamResolver.resolveCpuRamWithTrace).mockResolvedValueOnce({
      data: [],
      trace: baseDiagnostics.cpuMemory,
      capabilities: [],
    });
    vi.mocked(tauriApi.getClusterNodesNames).mockResolvedValue(["node-1"]);
    vi.mocked(diskResolver.resolveDiskWithTrace).mockResolvedValueOnce({
      data: { "node-1": "10.00 GiB" },
      trace: baseDiagnostics.disk,
      capabilities: [],
    });

    const result = await checkNodesHealth(cid);

    expect(result).toEqual([
      { name: "node-1", cpuUsage: "N/A", memoryUsage: "N/A", diskUsage: "10.00 GiB" },
    ]);
  });

  it("uses disk cache between calls within TTL", async () => {
    const cid = clusterId();
    await checkNodesHealth(cid);
    await checkNodesHealth(cid);

    expect(diskResolver.resolveDiskWithTrace).toHaveBeenCalledTimes(1);
  });

  it("re-fetches disk after cache TTL expires", async () => {
    const cid = clusterId();
    await checkNodesHealth(cid);
    vi.advanceTimersByTime(120_001);
    await checkNodesHealth(cid);

    expect(diskResolver.resolveDiskWithTrace).toHaveBeenCalledTimes(2);
  });

  it("stores and returns diagnostics", async () => {
    const cid = clusterId();
    await checkNodesHealth(cid);

    const diagnostics = getNodeMetricsDiagnostics(cid);

    expect(diagnostics?.cpuMemory.metric).toBe("cpu_memory");
    expect(diagnostics?.disk.metric).toBe("disk");
  });

  it("skips disk resolution when includeDisk is false", async () => {
    const cid = clusterId();

    const result = await checkNodesHealth(cid, undefined, { includeDisk: false });

    expect(result).toEqual([
      { name: "node-1", cpuUsage: "30%", memoryUsage: "40%", diskUsage: "N/A" },
      { name: "node-2", cpuUsage: "50%", memoryUsage: "60%", diskUsage: "N/A" },
    ]);
    expect(diskResolver.resolveDiskWithTrace).not.toHaveBeenCalled();
  });

  it("returns undefined and logs error when resolver throws", async () => {
    const cid = clusterId();
    vi.mocked(cpuRamResolver.resolveCpuRamWithTrace).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(logPlugin.error).mockResolvedValue(undefined);

    const result = await checkNodesHealth(cid);

    expect(result).toBeUndefined();
    expect(logPlugin.error).toHaveBeenCalledWith("boom");
  });
});
