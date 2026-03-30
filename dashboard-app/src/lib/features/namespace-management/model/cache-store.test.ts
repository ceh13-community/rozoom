import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { getNamespaces } from "$shared/api/tauri";

vi.mock("$shared/api/tauri", () => ({
  getNamespaces: vi.fn().mockResolvedValue(["default", "kube-system"]),
}));

vi.mock("$shared/cache", () => ({
  setCacheWithTTL: vi.fn().mockResolvedValue(undefined),
  getCache: vi.fn().mockResolvedValue(null),
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  debug: vi.fn().mockResolvedValue(undefined),
  error: vi.fn().mockResolvedValue(undefined),
}));

const SELECTIONS_KEY = "dashboard:namespace-selections:v1";

describe("namespace selections persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it("persists selected namespace per cluster", async () => {
    const module = await import("./cache-store");

    await module.setClusterNamespaces("cluster-a", ["default", "kube-system"]);
    module.setSelectedNamespace("cluster-a", "kube-system");

    expect(get(module.selectedNamespace)).toBe("kube-system");
    expect(JSON.parse(localStorage.getItem(SELECTIONS_KEY) || "{}")).toEqual({
      "cluster-a": "kube-system",
    });
  });

  it("restores persisted namespace for cluster", async () => {
    localStorage.setItem(SELECTIONS_KEY, JSON.stringify({ "cluster-a": "kube-system" }));
    const module = await import("./cache-store");

    await module.setClusterNamespaces("cluster-a", ["default", "kube-system"]);

    expect(get(module.selectedNamespace)).toBe("kube-system");
  });

  it("coalesces repeated namespace loads within cooldown window", async () => {
    const module = await import("./cache-store");

    await module.getClusterNamespaces("cluster-a");
    await module.getClusterNamespaces("cluster-a");
    await module.getClusterNamespaces("cluster-a");

    expect(vi.mocked(getNamespaces)).toHaveBeenCalledTimes(1);
  });

  it("keeps cached namespaces when the primary namespaces query fails", async () => {
    vi.mocked(getNamespaces).mockRejectedValueOnce(new Error("primary namespaces failed"));

    const module = await import("./cache-store");
    await module.setClusterNamespaces("cluster-a", ["default", "kube-system"]);
    const result = await module.getClusterNamespaces("cluster-a");

    expect(result).toEqual(["default", "kube-system"]);
    expect(get(module.namespaces)).toEqual(["default", "kube-system"]);
    expect(get(module.namespacesError)).toBe("primary namespaces failed");
  });

  it("ignores stale namespace responses after stopNamespaceActivity", async () => {
    let resolveNamespaces: ((value: string[]) => void) | null = null;
    vi.mocked(getNamespaces).mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          resolveNamespaces = resolve;
        }),
    );

    const module = await import("./cache-store");
    const loadPromise = module.getClusterNamespaces("cluster-a");
    await vi.waitFor(() => {
      expect(resolveNamespaces).not.toBeNull();
    });

    module.stopNamespaceActivity("cluster-a");
    (resolveNamespaces as ((value: string[]) => void) | null)?.(["late-ns"]);

    const result = await loadPromise;

    expect(result).toEqual([]);
    expect(get(module.namespaces)).toEqual([]);
    expect(get(module.isNamespacesLoading)).toBe(false);
  });
});
