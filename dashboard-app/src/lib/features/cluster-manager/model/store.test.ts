import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { KubeConfigFileType } from "$entities/config";
import {
  addClustersFromKubeconfigSelection,
  clustersList,
  removedClustersList,
  markClusterRefreshHintSeen,
  toggleClusterPin,
  removeCluster,
  restoreCluster,
  purgeCluster,
  updateClusterMeta,
  renameClusterContext,
} from "./store";

const mockSaveClusterOnDisk = vi.fn();
const mockSaveConfig = vi.fn();
const mockKubectlRawFront = vi.fn();

const mockGetClusterFromDisk = vi.fn();

vi.mock("../api/disk", () => ({
  saveClusterOnDisk: (...args: unknown[]) => mockSaveClusterOnDisk(...args),
  saveKubeConfig: vi.fn(),
  getClusterFromDisk: (...args: unknown[]) => mockGetClusterFromDisk(...args),
}));

const mockSaveRemovedConfig = vi.fn();

vi.mock("../api/config-storage-repo", () => ({
  loadConfig: vi.fn().mockResolvedValue([]),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
  loadRemovedConfig: vi.fn().mockResolvedValue([]),
  saveRemovedConfig: (...args: unknown[]) => mockSaveRemovedConfig(...args),
}));

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawFront: (...args: unknown[]) => mockKubectlRawFront(...args),
}));

const baseConfig: KubeConfigFileType = {
  apiVersion: "v1",
  kind: "Config",
  path: "/tmp/kubeconfig",
  clusters: [{ name: "alpha" }, { name: "beta" }],
  contexts: [
    { name: "alpha-context", context: { cluster: "alpha", user: "alpha-user" } },
    { name: "beta-context", context: { cluster: "beta", user: "beta-user" } },
  ],
  users: [{ name: "alpha-user" }, { name: "beta-user" }],
};

describe("cluster-manager store", () => {
  beforeEach(() => {
    clustersList.set([]);
    removedClustersList.set([]);
    mockSaveClusterOnDisk.mockReset();
    mockSaveConfig.mockReset();
    mockSaveRemovedConfig.mockReset();
    mockKubectlRawFront.mockReset();
    mockGetClusterFromDisk.mockReset();

    mockKubectlRawFront.mockResolvedValue({
      output: `
apiVersion: v1
clusters:
  - name: alpha
contexts:
  - name: alpha-context
    context:
      cluster: alpha
current-context: alpha-context
`,
      errors: "",
    });
    mockSaveClusterOnDisk.mockResolvedValue(undefined);
    mockSaveConfig.mockResolvedValue(undefined);

    vi.stubGlobal("crypto", {
      randomUUID: vi.fn().mockReturnValue("uuid-1"),
      getRandomValues: <T extends ArrayBufferView>(values: T) => values,
      subtle: {} as SubtleCrypto,
    } as unknown as Crypto);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds selected clusters with metadata", async () => {
    await addClustersFromKubeconfigSelection(baseConfig, baseConfig.path, [
      {
        name: "alpha",
        displayName: "Alpha Prod",
        env: "prod",
        provider: "AWS EKS",
        source: baseConfig.path,
        tags: ["aws", "prod"],
      },
    ]);

    const stored = get(clustersList);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe("alpha");
    expect(stored[0]?.displayName).toBe("Alpha Prod");
    expect(stored[0]?.env).toBe("prod");
    expect(stored[0]?.needsInitialRefreshHint).toBe(true);
    expect(mockSaveClusterOnDisk).toHaveBeenCalledWith(
      "uuid-1",
      expect.stringContaining("current-context: alpha-context"),
    );
    expect(mockSaveConfig).toHaveBeenCalledTimes(1);
  });

  it("rejects saving a flattened kubeconfig that points at a different cluster", async () => {
    mockKubectlRawFront.mockResolvedValue({
      output: `
apiVersion: v1
clusters:
  - name: minikube
contexts:
  - name: minikube
    context:
      cluster: minikube
current-context: minikube
`,
      errors: "",
    });

    await addClustersFromKubeconfigSelection(baseConfig, baseConfig.path, [{ name: "alpha" }]);

    expect(mockSaveClusterOnDisk).not.toHaveBeenCalled();
    expect(get(clustersList)).toHaveLength(0);
  });

  it("skips clusters that already exist", async () => {
    await addClustersFromKubeconfigSelection(baseConfig, baseConfig.path, [{ name: "alpha" }]);

    await addClustersFromKubeconfigSelection(baseConfig, baseConfig.path, [{ name: "alpha" }]);

    const stored = get(clustersList);
    expect(stored).toHaveLength(1);
    expect(mockSaveClusterOnDisk).toHaveBeenCalledTimes(1);
  });

  it("toggles pin state", async () => {
    await addClustersFromKubeconfigSelection(baseConfig, baseConfig.path, [{ name: "alpha" }]);

    await toggleClusterPin("uuid-1");

    const stored = get(clustersList);
    expect(stored[0]?.pinned).toBe(true);
  });

  it("clears the initial refresh hint once it has been acknowledged", async () => {
    await addClustersFromKubeconfigSelection(baseConfig, baseConfig.path, [{ name: "alpha" }]);

    await markClusterRefreshHintSeen("uuid-1");

    const stored = get(clustersList);
    expect(stored[0]?.needsInitialRefreshHint).toBe(false);
  });

  describe("renameClusterContext", () => {
    const storedKubeconfig = `apiVersion: v1
clusters:
  - name: alpha
contexts:
  - name: alpha
    context:
      cluster: alpha
current-context: alpha
`;

    it("renames context in kubeconfig and store", async () => {
      await addClustersFromKubeconfigSelection(baseConfig, baseConfig.path, [{ name: "alpha" }]);
      mockSaveConfig.mockReset();
      mockSaveClusterOnDisk.mockReset();
      mockGetClusterFromDisk.mockResolvedValue(storedKubeconfig);

      const result = await renameClusterContext("uuid-1", "alpha-prod");

      expect(result).toBe(true);
      expect(get(clustersList)[0]?.name).toBe("alpha-prod");
      expect(mockSaveClusterOnDisk).toHaveBeenCalledWith(
        "uuid-1",
        expect.stringContaining("alpha-prod"),
      );
      expect(mockSaveConfig).toHaveBeenCalledTimes(1);
    });

    it("returns false for non-existent cluster", async () => {
      const result = await renameClusterContext("non-existent", "new-name");
      expect(result).toBe(false);
    });

    it("returns false when kubeconfig not on disk", async () => {
      await addClustersFromKubeconfigSelection(baseConfig, baseConfig.path, [{ name: "alpha" }]);
      mockGetClusterFromDisk.mockResolvedValue(null);

      const result = await renameClusterContext("uuid-1", "new-name");
      expect(result).toBe(false);
    });
  });

  describe("updateClusterMeta with defaultNamespace", () => {
    it("saves defaultNamespace to cluster config", async () => {
      await addClustersFromKubeconfigSelection(baseConfig, baseConfig.path, [{ name: "alpha" }]);
      mockSaveConfig.mockReset();

      await updateClusterMeta("uuid-1", { defaultNamespace: "production" });

      const stored = get(clustersList);
      expect(stored[0]?.defaultNamespace).toBe("production");
      expect(mockSaveConfig).toHaveBeenCalledTimes(1);
    });

    it("clears defaultNamespace when set to empty string", async () => {
      await addClustersFromKubeconfigSelection(baseConfig, baseConfig.path, [{ name: "alpha" }]);
      await updateClusterMeta("uuid-1", { defaultNamespace: "staging" });
      mockSaveConfig.mockReset();

      await updateClusterMeta("uuid-1", { defaultNamespace: "" });

      const stored = get(clustersList);
      expect(stored[0]?.defaultNamespace).toBe("");
      expect(mockSaveConfig).toHaveBeenCalledTimes(1);
    });
  });

  describe("soft-delete and restore", () => {
    beforeEach(async () => {
      await addClustersFromKubeconfigSelection(baseConfig, baseConfig.path, [{ name: "alpha" }]);
      mockSaveConfig.mockReset();
      mockSaveRemovedConfig.mockReset();
    });

    it("moves cluster to removed list on delete", async () => {
      await removeCluster("uuid-1");

      expect(get(clustersList)).toHaveLength(0);

      const removed = get(removedClustersList);
      expect(removed).toHaveLength(1);
      expect(removed[0]?.name).toBe("alpha");
      expect(removed[0]?.removedAt).toBeDefined();
      expect(mockSaveConfig).toHaveBeenCalledTimes(1);
      expect(mockSaveRemovedConfig).toHaveBeenCalledTimes(1);
    });

    it("restores cluster from removed list", async () => {
      await removeCluster("uuid-1");
      await restoreCluster("uuid-1");

      expect(get(clustersList)).toHaveLength(1);
      expect(get(clustersList)[0]?.name).toBe("alpha");
      expect(get(clustersList)[0]?.removedAt).toBeUndefined();
      expect(get(removedClustersList)).toHaveLength(0);
    });

    it("purges cluster permanently from removed list", async () => {
      await removeCluster("uuid-1");
      await purgeCluster("uuid-1");

      expect(get(clustersList)).toHaveLength(0);
      expect(get(removedClustersList)).toHaveLength(0);
      expect(mockSaveRemovedConfig).toHaveBeenCalledTimes(2);
    });

    it("does nothing when removing a non-existent cluster", async () => {
      await removeCluster("non-existent");

      expect(get(clustersList)).toHaveLength(1);
      expect(get(removedClustersList)).toHaveLength(0);
      expect(mockSaveConfig).not.toHaveBeenCalled();
    });

    it("does nothing when restoring a non-existent cluster", async () => {
      await restoreCluster("non-existent");

      expect(get(clustersList)).toHaveLength(1);
      expect(get(removedClustersList)).toHaveLength(0);
    });
  });
});
