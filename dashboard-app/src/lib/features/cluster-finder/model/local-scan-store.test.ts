import { describe, expect, it, vi, beforeEach } from "vitest";
import { get } from "svelte/store";
import { KubeCluster, KubeConfig, KubeContext } from "$entities/config";
import {
  runLocalDiscoveryScan,
  clearLocalScan,
  localScanClusters,
  localScanConfig,
  isLocalScanning,
  localScanned,
  localScanError,
} from "./local-scan-store";

const scanKubeconfigs = vi.hoisted(() => vi.fn());
vi.mock("../api/scanner", () => ({ scanKubeconfigs }));

function makeConfig() {
  return new KubeConfig({
    apiVersion: "v1",
    kind: "Config",
    clusters: [new KubeCluster("minikube", { server: "https://127.0.0.1:8443" })],
    contexts: [new KubeContext("minikube", { cluster: "minikube", user: "minikube" })],
    users: [],
    path: "/home/u/.kube/config",
  });
}

describe("runLocalDiscoveryScan", () => {
  beforeEach(() => {
    scanKubeconfigs.mockReset();
    clearLocalScan();
    localScanned.set(false);
  });

  it("populates the shared store with discovered local-runtime clusters", async () => {
    scanKubeconfigs.mockResolvedValue(makeConfig());

    await runLocalDiscoveryScan();

    expect(get(localScanClusters).map((c) => c.contextName)).toEqual(["minikube"]);
    expect(get(localScanConfig)).not.toBeNull();
    expect(get(isLocalScanning)).toBe(false);
    expect(get(localScanned)).toBe(true);
    expect(get(localScanError)).toBeNull();
  });

  it("clears results and leaves no config when no kubeconfig is found", async () => {
    scanKubeconfigs.mockResolvedValue(null);

    await runLocalDiscoveryScan();

    expect(get(localScanClusters)).toEqual([]);
    expect(get(localScanConfig)).toBeNull();
    expect(get(localScanned)).toBe(true);
  });

  it("surfaces the raw scan error without throwing, so callers stay in control of UI", async () => {
    scanKubeconfigs.mockRejectedValue(new Error("EACCES: permission denied"));

    await runLocalDiscoveryScan();

    expect(get(localScanClusters)).toEqual([]);
    expect(get(localScanConfig)).toBeNull();
    expect(get(localScanError)).toBe("EACCES: permission denied");
    expect(get(isLocalScanning)).toBe(false);
    expect(get(localScanned)).toBe(true);
  });
});

describe("clearLocalScan", () => {
  it("resets results, config and error back to pre-scan state", async () => {
    scanKubeconfigs.mockResolvedValue(makeConfig());
    await runLocalDiscoveryScan();
    expect(get(localScanClusters).length).toBeGreaterThan(0);

    clearLocalScan();

    expect(get(localScanClusters)).toEqual([]);
    expect(get(localScanConfig)).toBeNull();
    expect(get(localScanError)).toBeNull();
  });
});
