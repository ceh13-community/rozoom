/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/svelte";
import * as workloadsFetcherModule from "./workloads-fetcher.svelte";

import * as logPlugin from "@tauri-apps/plugin-log";
import type { WorkloadType } from "$shared";

vi.mock("@sentry/sveltekit");
vi.mock("@tauri-apps/plugin-log");
vi.mock("./workloads-fetcher.svelte");

import TestWrapper from "../ui/test-wrapper.svelte";

describe("createWorkloadsStore", () => {
  let mockFetcher: {
    data: unknown;
    isLoading: boolean;
    error: string | null;
    cache: { state: "miss" | "fresh" | "stale"; cachedAt: number | null; ageMs: number | null };
    fetchWorkloads: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockFetcher = {
      data: null,
      isLoading: false,
      error: null,
      cache: { state: "miss", cachedAt: null, ageMs: null },
      fetchWorkloads: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
    };

    vi.mocked(workloadsFetcherModule.useWorkloadsFetcher).mockReturnValue(mockFetcher as any);
    vi.mocked(logPlugin.error).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("initialization", () => {
    it("should create store with required parameters", () => {
      const { component } = render(TestWrapper, {
        props: { params: { clusterUuid: "cluster-123" } },
      });

      expect(component.store.params.clusterUuid).toBe("cluster-123");
      expect(component.store.params.namespace).toBe("all");
      expect(component.store.params.workloadType).toBe("overview");
      expect(component.store.params.sortField).toBeUndefined();
    });

    it("should create store with custom namespace", () => {
      const { component } = render(TestWrapper, {
        props: {
          params: {
            clusterUuid: "cluster-123",
            namespace: "kube-system",
          },
        },
      });

      expect(component.store.params.namespace).toBe("kube-system");
    });

    it("should create store with custom workload type", () => {
      const { component } = render(TestWrapper, {
        props: {
          params: {
            clusterUuid: "cluster-123",
            initialWorkloadType: "pods",
          },
        },
      });

      expect(component.store.params.workloadType).toBe("pods");
    });

    it("should create store with sort field", () => {
      const { component } = render(TestWrapper, {
        props: {
          params: {
            clusterUuid: "cluster-123",
            sortField: "name",
          },
        },
      });

      expect(component.store.params.sortField).toBe("name");
    });

    it("should create store with all custom parameters", () => {
      const { component } = render(TestWrapper, {
        props: {
          params: {
            clusterUuid: "cluster-123",
            namespace: "default",
            initialWorkloadType: "deployments",
            sortField: "name",
          },
        },
      });

      expect(component.store.params).toEqual({
        clusterUuid: "cluster-123",
        namespace: "default",
        workloadType: "deployments",
        sortField: "name",
      });
    });
  });

  describe("data access", () => {
    it("should expose fetcher data", () => {
      mockFetcher.data = { pods: { quantity: 5 } };

      const { component } = render(TestWrapper, {
        props: { params: { clusterUuid: "cluster-123" } },
      });

      expect(component.store.data).toEqual({ pods: { quantity: 5 } });
    });

    it("should expose isLoading state", () => {
      mockFetcher.isLoading = true;

      const { component } = render(TestWrapper, {
        props: { params: { clusterUuid: "cluster-123" } },
      });

      expect(component.store.isLoading).toBe(true);
    });

    it("should expose error state", () => {
      mockFetcher.error = "Failed to fetch";

      const { component } = render(TestWrapper, {
        props: { params: { clusterUuid: "cluster-123" } },
      });

      expect(component.store.error).toBe("Failed to fetch");
    });

    it("should expose cache state", () => {
      mockFetcher.cache = { state: "fresh", cachedAt: Date.now(), ageMs: 0 };

      const { component } = render(TestWrapper, {
        props: { params: { clusterUuid: "cluster-123" } },
      });

      expect(component.store.cache.state).toBe("fresh");
    });

    it("should expose params", () => {
      const { component } = render(TestWrapper, {
        props: {
          params: {
            clusterUuid: "cluster-123",
            namespace: "default",
          },
        },
      });

      expect(component.store.params).toEqual({
        clusterUuid: "cluster-123",
        namespace: "default",
        workloadType: "overview",
        sortField: undefined,
      });
    });
  });

  describe("updateParams", () => {
    it("should update single parameter", () => {
      const { component } = render(TestWrapper, {
        props: { params: { clusterUuid: "cluster-123" } },
      });

      const changed = component.store.updateParams({ namespace: "kube-system" });

      expect(changed).toBe(true);
      expect(component.store.params.namespace).toBe("kube-system");
    });

    it("should update multiple parameters", () => {
      const { component } = render(TestWrapper, {
        props: { params: { clusterUuid: "cluster-123" } },
      });

      const changed = component.store.updateParams({
        namespace: "default",
        workloadType: "pods",
        sortField: "name",
      });

      expect(changed).toBe(true);
      expect(component.store.params.namespace).toBe("default");
      expect(component.store.params.workloadType).toBe("pods");
      expect(component.store.params.sortField).toBe("name");
    });

    it("should return false when no changes", () => {
      const { component } = render(TestWrapper, {
        props: {
          params: {
            clusterUuid: "cluster-123",
            namespace: "default",
          },
        },
      });

      const changed = component.store.updateParams({ namespace: "default" });

      expect(changed).toBe(false);
    });

    it("should ignore undefined values", () => {
      const { component } = render(TestWrapper, {
        props: {
          params: {
            clusterUuid: "cluster-123",
            namespace: "default",
          },
        },
      });

      const changed = component.store.updateParams({ namespace: undefined });

      expect(changed).toBe(false);
      expect(component.store.params.namespace).toBe("default");
    });

    it("should return true only if at least one param changed", () => {
      const { component } = render(TestWrapper, {
        props: {
          params: {
            clusterUuid: "cluster-123",
            namespace: "default",
          },
        },
      });

      const changed = component.store.updateParams({
        namespace: "default", // Same
        workloadType: "pods", // Changed
      });

      expect(changed).toBe(true);
      expect(component.store.params.workloadType).toBe("pods");
    });

    it("should handle empty update object", () => {
      const { component } = render(TestWrapper, {
        props: { params: { clusterUuid: "cluster-123" } },
      });

      const changed = component.store.updateParams({});

      expect(changed).toBe(false);
    });

    it("should update clusterUuid", () => {
      const { component } = render(TestWrapper, {
        props: { params: { clusterUuid: "cluster-123" } },
      });

      const changed = component.store.updateParams({ clusterUuid: "cluster-456" });

      expect(changed).toBe(true);
      expect(component.store.params.clusterUuid).toBe("cluster-456");
    });
  });

  describe("reset", () => {
    it("should call fetcher reset", () => {
      const { component } = render(TestWrapper, {
        props: { params: { clusterUuid: "cluster-123" } },
      });

      component.store.reset();

      expect(mockFetcher.reset).toHaveBeenCalled();
    });

    it("should call reset only once per call", () => {
      const { component } = render(TestWrapper, {
        props: { params: { clusterUuid: "cluster-123" } },
      });

      component.store.reset();
      component.store.reset();

      expect(mockFetcher.reset).toHaveBeenCalledTimes(2);
    });
  });

  describe("error handling", () => {
    it("should log error when fetchWorkloads fails", async () => {
      const error = new Error("Network error");
      mockFetcher.fetchWorkloads.mockRejectedValue(error);

      render(TestWrapper, {
        props: { params: { clusterUuid: "cluster-123" } },
      });

      // Wait for effect to run
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(logPlugin.error).toHaveBeenCalledWith("Failed to fetch workloads: Network error");
    });

    // it("should capture exception in Sentry", async () => {
    //   const error = new Error("Network error");
    //   mockFetcher.fetchWorkloads.mockRejectedValue(error);

    //   render(TestWrapper, {
    //     props: { params: { clusterUuid: "cluster-123" } },
    //   });

    //   await new Promise((resolve) => setTimeout(resolve, 100));

    //   expect(Sentry.captureException).toHaveBeenCalledWith(error);
    // });

    it("should handle non-Error exceptions", async () => {
      mockFetcher.fetchWorkloads.mockRejectedValue("String error");

      render(TestWrapper, {
        props: { params: { clusterUuid: "cluster-123" } },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(logPlugin.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to fetch workloads"),
      );
    });
  });

  describe("workload types", () => {
    const workloadTypes = [
      "overview",
      "globaltriage",
      "pods",
      "deployments",
      "daemonsets",
      "statefulsets",
      "replicasets",
      "jobs",
      "cronjobs",
      "podsrestarts",
      "nodesstatus",
      "nodespressures",
      "configmaps",
      "secrets",
      "resourcequotas",
      "limitranges",
      "horizontalpodautoscalers",
      "poddisruptionbudgets",
      "priorityclasses",
      "runtimeclasses",
      "leases",
      "mutatingwebhookconfigurations",
      "validatingwebhookconfigurations",
      "serviceaccounts",
      "roles",
      "rolebindings",
      "clusterroles",
      "clusterrolebindings",
      "accessreviews",
      "customresourcedefinitions",
      "services",
      "endpoints",
      "endpointslices",
      "ingresses",
      "ingressclasses",
      "portforwarding",
      "networkpolicies",
      "persistentvolumeclaims",
      "persistentvolumes",
      "storageclasses",
      "volumeattributesclasses",
      "volumesnapshots",
      "volumesnapshotcontents",
      "volumesnapshotclasses",
      "csistoragecapacities",
    ];

    workloadTypes.forEach((type) => {
      it(`should support ${type} workload type`, () => {
        const { component } = render(TestWrapper, {
          props: {
            params: {
              clusterUuid: "cluster-123",
              initialWorkloadType: type as WorkloadType,
            },
          },
        });

        expect(component.store.params.workloadType).toBe(type);
      });
    });
  });

  describe("edge cases", () => {
    it("should handle empty clusterUuid", () => {
      const { component } = render(TestWrapper, {
        props: { params: { clusterUuid: "" } },
      });

      expect(component.store.params.clusterUuid).toBe("");
    });

    it("should handle special characters in namespace", () => {
      const { component } = render(TestWrapper, {
        props: {
          params: {
            clusterUuid: "cluster-123",
            namespace: "test-namespace_123",
          },
        },
      });

      expect(component.store.params.namespace).toBe("test-namespace_123");
    });

    it("should handle null data from fetcher", () => {
      mockFetcher.data = null;

      const { component } = render(TestWrapper, {
        props: { params: { clusterUuid: "cluster-123" } },
      });

      expect(component.store.data).toBeNull();
    });

    it("should handle complex data structures", () => {
      const complexData = {
        pods: { quantity: 10 },
        deployments: { quantity: 5 },
        items: [{ name: "test" }],
      };

      mockFetcher.data = complexData;

      const { component } = render(TestWrapper, {
        props: { params: { clusterUuid: "cluster-123" } },
      });

      expect(component.store.data).toEqual(complexData);
    });

    it("should preserve param values during multiple updates", () => {
      const { component } = render(TestWrapper, {
        props: {
          params: {
            clusterUuid: "cluster-123",
            namespace: "default",
          },
        },
      });

      component.store.updateParams({ workloadType: "pods" });
      component.store.updateParams({ sortField: "name" });

      expect(component.store.params).toEqual({
        clusterUuid: "cluster-123",
        namespace: "default",
        workloadType: "pods",
        sortField: "name",
      });
    });
  });
});
