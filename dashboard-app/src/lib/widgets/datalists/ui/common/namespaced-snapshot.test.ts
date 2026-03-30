import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$features/namespace-management", () => ({
  getSelectedNamespaceList: vi.fn(),
}));

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawArgsFront: vi.fn(),
}));

const browserInvokeState = vi.hoisted(() => ({
  invoke: null as null | ((cmd: string, payload?: unknown) => Promise<unknown>),
}));

vi.mock("$shared/lib/tauri-runtime", () => ({
  getBrowserInvokeFallback: vi.fn(() => browserInvokeState.invoke),
}));

import { getSelectedNamespaceList } from "$features/namespace-management";
import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import { fetchNamespacedSnapshotItems } from "./namespaced-snapshot";

describe("fetchNamespacedSnapshotItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserInvokeState.invoke = null;
  });

  it("fetches all namespaces when selection is all", async () => {
    vi.mocked(getSelectedNamespaceList).mockReturnValue(null);
    vi.mocked(kubectlRawArgsFront).mockResolvedValue({
      output: JSON.stringify({ items: [{ metadata: { name: "a" } }] }),
      errors: "",
      code: 0,
    });

    const items = await fetchNamespacedSnapshotItems<{ metadata: { name: string } }>({
      clusterId: "c1",
      selectedNamespace: "all",
      resource: "deployments",
      errorMessage: "sync failed",
    });

    expect(items).toHaveLength(1);
    expect(kubectlRawArgsFront).toHaveBeenCalledWith(
      ["get", "deployments", "--all-namespaces", "-o", "json", "--request-timeout=10s"],
      { clusterId: "c1" },
    );
  });

  it("fetches single namespace when exactly one is selected", async () => {
    vi.mocked(getSelectedNamespaceList).mockReturnValue(["argocd"]);
    vi.mocked(kubectlRawArgsFront).mockResolvedValue({
      output: JSON.stringify({ items: [{ metadata: { namespace: "argocd" } }] }),
      errors: "",
      code: 0,
    });

    const items = await fetchNamespacedSnapshotItems<{ metadata: { namespace: string } }>({
      clusterId: "c1",
      selectedNamespace: "argocd",
      resource: "jobs",
      errorMessage: "sync failed",
    });

    expect(items).toHaveLength(1);
    expect(kubectlRawArgsFront).toHaveBeenCalledWith(
      ["get", "jobs", "-n", "argocd", "-o", "json", "--request-timeout=10s"],
      {
        clusterId: "c1",
      },
    );
  });

  it("passes abort signal through to kubectl requests", async () => {
    vi.mocked(getSelectedNamespaceList).mockReturnValue(["argocd"]);
    vi.mocked(kubectlRawArgsFront).mockResolvedValue({
      output: JSON.stringify({ items: [] }),
      errors: "",
      code: 0,
    });
    const controller = new AbortController();

    await fetchNamespacedSnapshotItems({
      clusterId: "c1",
      selectedNamespace: "argocd",
      resource: "pods",
      errorMessage: "sync failed",
      signal: controller.signal,
    });

    expect(kubectlRawArgsFront).toHaveBeenCalledWith(
      ["get", "pods", "-n", "argocd", "-o", "json", "--request-timeout=10s"],
      {
        clusterId: "c1",
        signal: controller.signal,
      },
    );
  });

  it("fetches and merges multiple namespaces when multi-select is active", async () => {
    vi.mocked(getSelectedNamespaceList).mockReturnValue(["argocd", "external-secrets"]);
    vi.mocked(kubectlRawArgsFront)
      .mockResolvedValueOnce({
        output: JSON.stringify({ items: [{ metadata: { namespace: "argocd" } }] }),
        errors: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({ items: [{ metadata: { namespace: "external-secrets" } }] }),
        errors: "",
        code: 0,
      });

    const items = await fetchNamespacedSnapshotItems<{ metadata: { namespace: string } }>({
      clusterId: "c1",
      selectedNamespace: "argocd,external-secrets",
      resource: "pods",
      errorMessage: "sync failed",
    });

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.metadata.namespace)).toEqual(["argocd", "external-secrets"]);
  });

  it("deduplicates identical in-flight snapshot requests", async () => {
    vi.mocked(getSelectedNamespaceList).mockReturnValue(["argocd"]);
    let resolveResponse: (() => void) | null = null;
    vi.mocked(kubectlRawArgsFront).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveResponse = () =>
            resolve({
              output: JSON.stringify({ items: [{ metadata: { namespace: "argocd" } }] }),
              errors: "",
              code: 0,
            });
        }),
    );

    const a = fetchNamespacedSnapshotItems<{ metadata: { namespace: string } }>({
      clusterId: "c1",
      selectedNamespace: "argocd",
      resource: "pods",
      errorMessage: "sync failed",
    });
    const b = fetchNamespacedSnapshotItems<{ metadata: { namespace: string } }>({
      clusterId: "c1",
      selectedNamespace: "argocd",
      resource: "pods",
      errorMessage: "sync failed",
    });

    if (!resolveResponse) throw new Error("missing resolver");
    (resolveResponse as () => void)();
    const [itemsA, itemsB] = await Promise.all([a, b]);
    expect(itemsA).toEqual(itemsB);
    expect(kubectlRawArgsFront).toHaveBeenCalledTimes(1);
  });

  it("limits multi-namespace fetch concurrency to avoid request spikes", async () => {
    vi.mocked(getSelectedNamespaceList).mockReturnValue([
      "ns-1",
      "ns-2",
      "ns-3",
      "ns-4",
      "ns-5",
      "ns-6",
      "ns-7",
      "ns-8",
      "ns-9",
    ]);
    let active = 0;
    let maxActive = 0;
    vi.mocked(kubectlRawArgsFront).mockImplementation(async (args) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      const namespace = args[4];
      return {
        output: JSON.stringify({ items: [{ metadata: { namespace } }] }),
        errors: "",
        code: 0,
      };
    });

    const items = await fetchNamespacedSnapshotItems<{ metadata: { namespace: string } }>({
      clusterId: "c1",
      selectedNamespace: "ns-1,ns-2,ns-3,ns-4,ns-5,ns-6,ns-7,ns-8,ns-9",
      resource: "pods",
      errorMessage: "sync failed",
    });

    expect(items).toHaveLength(9);
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  it("reports progress for multi-namespace fetches", async () => {
    vi.mocked(getSelectedNamespaceList).mockReturnValue(["ns-1", "ns-2", "ns-3", "ns-4", "ns-5"]);
    vi.mocked(kubectlRawArgsFront).mockResolvedValue({
      output: JSON.stringify({ items: [] }),
      errors: "",
      code: 0,
    });
    const onProgress = vi.fn();

    await fetchNamespacedSnapshotItems({
      clusterId: "c1",
      selectedNamespace: "ns-1,ns-2,ns-3,ns-4,ns-5",
      resource: "pods",
      errorMessage: "sync failed",
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledWith({ completed: 0, total: 5 });
    expect(onProgress).toHaveBeenLastCalledWith({ completed: 5, total: 5 });
  });

  it("returns empty list when no namespaces are selected", async () => {
    vi.mocked(getSelectedNamespaceList).mockReturnValue([]);

    const items = await fetchNamespacedSnapshotItems({
      clusterId: "c1",
      selectedNamespace: "__no_namespaces__",
      resource: "pods",
      errorMessage: "sync failed",
    });

    expect(items).toEqual([]);
    expect(kubectlRawArgsFront).not.toHaveBeenCalled();
  });

  it("throws normalized error when kubectl command fails", async () => {
    vi.mocked(getSelectedNamespaceList).mockReturnValue(["argocd"]);
    vi.mocked(kubectlRawArgsFront).mockResolvedValue({
      output: "",
      errors: "boom",
      code: 1,
    });

    await expect(
      fetchNamespacedSnapshotItems({
        clusterId: "c1",
        selectedNamespace: "argocd",
        resource: "pods",
        errorMessage: "sync failed",
      }),
    ).rejects.toThrow("boom");
  });

  it("accepts browser invoke snapshot items when a fallback bridge is present", async () => {
    browserInvokeState.invoke = vi.fn(async () => ({
      items: [{ metadata: { namespace: "qa-workloads", name: "qa-api-0" } }],
    }));

    const items = await fetchNamespacedSnapshotItems<{
      metadata: { namespace: string; name: string };
    }>({
      clusterId: "c1",
      selectedNamespace: "all",
      resource: "pods",
      errorMessage: "sync failed",
    });

    expect(items).toEqual([{ metadata: { namespace: "qa-workloads", name: "qa-api-0" } }]);
    expect(kubectlRawArgsFront).not.toHaveBeenCalled();
  });
});
