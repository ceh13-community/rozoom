import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_NAMESPACE_SELECTION } from "$features/namespace-management";
import { clearWorkloadEvents, listWorkloadEvents } from "./workload-telemetry";

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlJson: vi.fn(),
  kubectlRawFront: vi.fn(),
}));

import { kubectlJson, kubectlRawFront } from "$shared/api/kubectl-proxy";
import {
  __getWorkloadsFetcherMemoryCacheStatsForTests,
  __resetWorkloadsFetcherCacheForTests,
  invalidateWorkloadsCache,
  prefetchWorkloadSnapshot,
  prefetchWorkloadSnapshots,
  useWorkloadsFetcher,
} from "./workloads-fetcher.svelte";
import type { WorkloadOverview } from "$shared/model/workloads";

describe("workloads-fetcher namespace filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetWorkloadsFetcherCacheForTests();
    clearWorkloadEvents();
    window.localStorage.clear();
  });

  it("filters overview counts for multi-namespace selection", async () => {
    vi.mocked(kubectlRawFront).mockImplementation(async (cmd: string) => {
      if (
        cmd.startsWith("get pods,deployments,daemonsets,statefulsets,replicasets,jobs,cronjobs")
      ) {
        return {
          output:
            "Pod argocd pod-a\n" +
            "Pod monitoring pod-b\n" +
            "Pod kube-system pod-c\n" +
            "Deployment argocd dep-a\n" +
            "Deployment default dep-b\n" +
            "DaemonSet monitoring ds-a\n" +
            "StatefulSet kube-system sts-a\n" +
            "ReplicaSet argocd rs-a\n" +
            "Job monitoring job-a\n" +
            "CronJob default cj-a\n",
          errors: "",
          code: 0,
        };
      }
      if (cmd.startsWith("get nodes"))
        return { output: "node-a\nnode-b\nnode-c\n", errors: "", code: 0 };
      return { output: "", errors: "", code: 0 };
    });

    const fetcher = useWorkloadsFetcher();
    await fetcher.fetchWorkloads("overview", "argocd,monitoring", "cluster-a");

    const data = fetcher.data as WorkloadOverview;
    expect(data.pods.quantity).toBe(2);
    expect(data.deployments.quantity).toBe(1);
    expect(data.daemonsets.quantity).toBe(1);
    expect(data.statefulsets.quantity).toBe(0);
    expect(data.replicasets.quantity).toBe(1);
    expect(data.jobs.quantity).toBe(1);
    expect(data.cronjobs.quantity).toBe(0);
    expect(data.nodes.quantity).toBe(3);
    expect(vi.mocked(kubectlRawFront)).toHaveBeenCalledWith(
      expect.stringContaining("--all-namespaces"),
      expect.objectContaining({ clusterId: "cluster-a" }),
    );
  });

  it("filters namespaced workload items for multi-namespace selection", async () => {
    vi.mocked(kubectlJson).mockResolvedValue({
      items: [
        { metadata: { namespace: "monitoring", name: "svc-b" } },
        { metadata: { namespace: "argocd", name: "svc-a" } },
        { metadata: { namespace: "kube-system", name: "svc-c" } },
      ],
    });

    const fetcher = useWorkloadsFetcher();
    await fetcher.fetchWorkloads("services", "argocd,monitoring", "cluster-a", "name");

    const data = fetcher.data as Array<{ metadata: { namespace: string; name: string } }>;
    expect(data).toHaveLength(2);
    expect(data.map((item) => item.metadata.name)).toEqual(["svc-a", "svc-b"]);
  });

  it("returns empty data for namespaced workloads when no namespaces are selected", async () => {
    const fetcher = useWorkloadsFetcher();
    await fetcher.fetchWorkloads("pods", EMPTY_NAMESPACE_SELECTION, "cluster-a");

    expect(fetcher.data).toEqual([]);
    expect(kubectlJson).not.toHaveBeenCalled();
  });

  it("hydrates overview data from scope cache before background refresh completes", async () => {
    vi.mocked(kubectlRawFront).mockImplementation(async (cmd: string) => {
      if (
        cmd.startsWith("get pods,deployments,daemonsets,statefulsets,replicasets,jobs,cronjobs")
      ) {
        return {
          output: "Pod default pod-a\nPod default pod-b\n",
          errors: "",
          code: 0,
        };
      }
      if (cmd.startsWith("get nodes")) return { output: "node-a\n", errors: "", code: 0 };
      return { output: "", errors: "", code: 0 };
    });

    const fetcherA = useWorkloadsFetcher();
    await fetcherA.fetchWorkloads("overview", "all", "cluster-cache-a", "name");
    expect((fetcherA.data as WorkloadOverview).pods.quantity).toBe(2);

    let delayedPods = true;
    let resolvePods: (() => void) | null = null;
    vi.mocked(kubectlRawFront).mockImplementation((cmd: string) => {
      if (
        cmd.startsWith("get pods,deployments,daemonsets,statefulsets,replicasets,jobs,cronjobs") &&
        delayedPods
      ) {
        delayedPods = false;
        return new Promise((resolve) => {
          resolvePods = () =>
            resolve({
              output: "Pod default pod-a\nPod default pod-b\nPod default pod-c\n",
              errors: "",
              code: 0,
            });
        });
      }
      if (cmd.startsWith("get nodes"))
        return Promise.resolve({ output: "node-a\n", errors: "", code: 0 });
      return Promise.resolve({ output: "", errors: "", code: 0 });
    });

    const fetcherB = useWorkloadsFetcher();
    const pending = fetcherB.fetchWorkloads("overview", "all", "cluster-cache-a", "name");
    expect((fetcherB.data as WorkloadOverview).pods.quantity).toBe(2);
    expect(fetcherB.isLoading).toBe(true);

    if (!resolvePods) throw new Error("Expected delayed pods resolver");
    (resolvePods as () => void)();
    await pending;
  });

  it("does not reuse cache across different namespace scope", async () => {
    vi.mocked(kubectlRawFront).mockImplementation(async (cmd: string) => {
      if (
        cmd.startsWith("get pods,deployments,daemonsets,statefulsets,replicasets,jobs,cronjobs")
      ) {
        return { output: "Pod default pod-a\n", errors: "", code: 0 };
      }
      if (cmd.startsWith("get nodes")) return { output: "node-a\n", errors: "", code: 0 };
      return { output: "", errors: "", code: 0 };
    });

    const fetcherA = useWorkloadsFetcher();
    await fetcherA.fetchWorkloads("overview", "all", "cluster-cache-b", "name");

    vi.mocked(kubectlRawFront).mockImplementation(
      () =>
        new Promise(() => {
          // keep request pending; assertion is about initial cached state
        }),
    );

    const fetcherB = useWorkloadsFetcher();
    void fetcherB.fetchWorkloads("overview", "kube-system", "cluster-cache-b", "name");
    expect(fetcherB.data).toBe(null);
  });

  it("hydrates stale cache snapshot and refreshes in background", async () => {
    const cacheKey = "cluster-stale::overview::all::name";
    window.localStorage.setItem(
      `dashboard.workloads.cache.v1:${encodeURIComponent(cacheKey)}`,
      JSON.stringify({
        schemaVersion: 1,
        cachedAt: Date.now() - 12 * 60 * 1000,
        data: {
          pods: { quantity: 9 },
          deployments: { quantity: 0 },
          daemonsets: { quantity: 0 },
          statefulsets: { quantity: 0 },
          replicasets: { quantity: 0 },
          jobs: { quantity: 0 },
          cronjobs: { quantity: 0 },
          nodes: { quantity: 1 },
        },
      }),
    );

    let delayedPods = true;
    let release: (() => void) | null = null;
    vi.mocked(kubectlRawFront).mockImplementation((cmd: string) => {
      if (
        cmd.startsWith("get pods,deployments,daemonsets,statefulsets,replicasets,jobs,cronjobs") &&
        delayedPods
      ) {
        delayedPods = false;
        return new Promise((resolve) => {
          release = () => resolve({ output: "", errors: "", code: 0 });
        });
      }
      return Promise.resolve({ output: "", errors: "", code: 0 });
    });

    const fetcher = useWorkloadsFetcher();
    const pending = fetcher.fetchWorkloads("overview", "all", "cluster-stale", "name");
    expect((fetcher.data as WorkloadOverview).pods.quantity).toBe(9);
    expect(fetcher.cache.state).toBe("stale");
    if (!release) throw new Error("expected release function");
    (release as () => void)();
    await pending;

    const names = listWorkloadEvents().map((event) => event.name);
    expect(names).toContain("workloads.cache_stale_hit");
  });

  it("deduplicates identical overview requests across parallel fetchers", async () => {
    let delayedPods = true;
    let resolvePods: (() => void) | null = null;
    vi.mocked(kubectlRawFront).mockImplementation((cmd: string) => {
      if (
        cmd.startsWith("get pods,deployments,daemonsets,statefulsets,replicasets,jobs,cronjobs") &&
        delayedPods
      ) {
        delayedPods = false;
        return new Promise((resolve) => {
          resolvePods = () => resolve({ output: "Pod default pod-a\n", errors: "", code: 0 });
        });
      }
      if (cmd.startsWith("get nodes"))
        return Promise.resolve({ output: "node-a\n", errors: "", code: 0 });
      return Promise.resolve({ output: "", errors: "", code: 0 });
    });

    const fetcherA = useWorkloadsFetcher();
    const fetcherB = useWorkloadsFetcher();
    const a = fetcherA.fetchWorkloads("overview", "all", "cluster-dedupe", "name");
    const b = fetcherB.fetchWorkloads("overview", "all", "cluster-dedupe", "name");

    if (!resolvePods) throw new Error("Expected delayed pods resolver");
    (resolvePods as () => void)();
    await Promise.all([a, b]);

    expect(vi.mocked(kubectlRawFront)).toHaveBeenCalledTimes(2);
    const events = listWorkloadEvents();
    expect(events.some((event) => event.name === "workloads.request_deduped")).toBe(true);
  });

  it("prefetches workload snapshot into persistent cache", async () => {
    vi.mocked(kubectlRawFront).mockImplementation(async (cmd: string) => {
      if (
        cmd.startsWith("get pods,deployments,daemonsets,statefulsets,replicasets,jobs,cronjobs")
      ) {
        return { output: "Pod default pod-a\n", errors: "", code: 0 };
      }
      if (cmd.startsWith("get nodes")) return { output: "node-a\n", errors: "", code: 0 };
      return { output: "", errors: "", code: 0 };
    });

    await prefetchWorkloadSnapshot({
      workloadType: "overview",
      namespace: "all",
      clusterUuid: "cluster-prefetch",
      sortField: "name",
    });

    const key = "dashboard.workloads.cache.v1:cluster-prefetch%3A%3Aoverview%3A%3Aall%3A%3Aname";
    const persisted = window.localStorage.getItem(key);
    expect(persisted).toBeTruthy();
  });

  it("tracks incremental merge when workload items are unchanged", async () => {
    vi.mocked(kubectlJson)
      .mockResolvedValueOnce({
        items: [
          {
            metadata: { uid: "svc-1", namespace: "default", name: "svc-a", resourceVersion: "10" },
            status: { phase: "Active" },
          },
        ],
      })
      .mockResolvedValueOnce({
        items: [
          {
            metadata: { uid: "svc-1", namespace: "default", name: "svc-a", resourceVersion: "10" },
            status: { phase: "Active" },
          },
        ],
      });

    const fetcher = useWorkloadsFetcher();
    await fetcher.fetchWorkloads("services", "all", "cluster-merge", "name");
    const firstReference = (fetcher.data as Array<{ metadata: { uid: string } }>)[0];
    await fetcher.fetchWorkloads("services", "all", "cluster-merge", "name", true);
    const secondReference = (fetcher.data as Array<{ metadata: { uid: string } }>)[0];
    expect(secondReference).toBe(firstReference);

    const names = listWorkloadEvents().map((event) => event.name);
    expect(names).toContain("workloads.incremental_merge");
  });

  it("prefetches workload snapshots in bounded batches and skips local-only workloads", async () => {
    vi.mocked(kubectlRawFront).mockImplementation(async (cmd: string) => {
      if (
        cmd.startsWith("get pods,deployments,daemonsets,statefulsets,replicasets,jobs,cronjobs")
      ) {
        return {
          output: "Pod default pod-a\nDeployment default dep-a\nJob default job-a\n",
          errors: "",
          code: 0,
        };
      }
      if (cmd.startsWith("get nodes")) return { output: "node-a\n", errors: "", code: 0 };
      return { output: "", errors: "", code: 0 };
    });

    await prefetchWorkloadSnapshots({
      workloadTypes: ["pods", "deployments", "jobs", "nodesstatus", "helm", "pods"],
      namespace: "all",
      clusterUuid: "cluster-prefetch-batch",
      sortField: "name",
      maxConcurrent: 2,
    });

    expect(
      window.localStorage.getItem(
        "dashboard.workloads.cache.v1:cluster-prefetch-batch%3A%3Apods%3A%3Aall%3A%3Aname",
      ),
    ).toBeTruthy();
    expect(
      window.localStorage.getItem(
        "dashboard.workloads.cache.v1:cluster-prefetch-batch%3A%3Adeployments%3A%3Aall%3A%3Aname",
      ),
    ).toBeTruthy();
    expect(
      window.localStorage.getItem(
        "dashboard.workloads.cache.v1:cluster-prefetch-batch%3A%3Ajobs%3A%3Aall%3A%3Aname",
      ),
    ).toBeTruthy();
    expect(
      window.localStorage.getItem(
        "dashboard.workloads.cache.v1:cluster-prefetch-batch%3A%3Anodesstatus%3A%3Aall%3A%3Aname",
      ),
    ).toBeTruthy();
    expect(
      window.localStorage.getItem(
        "dashboard.workloads.cache.v1:cluster-prefetch-batch%3A%3Ahelm%3A%3Aall%3A%3Aname",
      ),
    ).toBeNull();
  });

  it("keeps repeated multi-cluster prefetch waves bounded and cache-isolated", async () => {
    let active = 0;
    let maxActive = 0;

    vi.mocked(kubectlJson).mockImplementation(
      async (_cmd: string, options?: { clusterId?: string }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return {
          items: [
            {
              metadata: {
                namespace: "default",
                name: `svc-${options?.clusterId ?? "unknown"}`,
              },
            },
          ],
        };
      },
    );

    for (let index = 0; index < 24; index += 1) {
      await prefetchWorkloadSnapshots({
        workloadTypes: ["services", "endpoints", "services", "ingresses"],
        namespace: "all",
        clusterUuid: `cluster-wave-${index}`,
        sortField: "name",
        maxConcurrent: 99,
      });
    }

    expect(maxActive).toBeLessThanOrEqual(6);
    expect(
      window.localStorage.getItem(
        "dashboard.workloads.cache.v1:cluster-wave-0%3A%3Aservices%3A%3Aall%3A%3Aname",
      ),
    ).toBeTruthy();
    expect(
      window.localStorage.getItem(
        "dashboard.workloads.cache.v1:cluster-wave-23%3A%3Aservices%3A%3Aall%3A%3Aname",
      ),
    ).toBeTruthy();
    expect(
      window.localStorage.getItem(
        "dashboard.workloads.cache.v1:cluster-wave-23%3A%3Aingresses%3A%3Aall%3A%3Aname",
      ),
    ).toBeTruthy();
  });

  it("emits telemetry for cold start, cache hit and refresh duration", async () => {
    vi.mocked(kubectlRawFront).mockImplementation(async (cmd: string) => {
      if (
        cmd.startsWith("get pods,deployments,daemonsets,statefulsets,replicasets,jobs,cronjobs")
      ) {
        return { output: "Pod default pod-a\n", errors: "", code: 0 };
      }
      if (cmd.startsWith("get nodes")) return { output: "node-a\n", errors: "", code: 0 };
      return { output: "", errors: "", code: 0 };
    });

    const first = useWorkloadsFetcher();
    await first.fetchWorkloads("overview", "all", "cluster-telemetry", "name");

    const second = useWorkloadsFetcher();
    await second.fetchWorkloads("overview", "all", "cluster-telemetry", "name");

    const names = listWorkloadEvents().map((event) => event.name);
    expect(names).toContain("workloads.cold_start");
    expect(names).toContain("workloads.cache_hit");
    expect(names).toContain("workloads.refresh_duration");
  });

  it("invalidates persisted and in-memory cache by scope", async () => {
    vi.mocked(kubectlJson).mockResolvedValue({
      items: [{ metadata: { namespace: "default", name: "svc-a" } }],
    });
    const fetcher = useWorkloadsFetcher();
    await fetcher.fetchWorkloads("services", "all", "cluster-invalidate", "name");

    const keepKey = "dashboard.workloads.cache.v1:cluster-other%3A%3Aservices%3A%3Aall%3A%3Aname";
    window.localStorage.setItem(
      keepKey,
      JSON.stringify({
        schemaVersion: 1,
        cachedAt: Date.now(),
        data: [{ metadata: { namespace: "default", name: "svc-b" } }],
      }),
    );

    const removed = invalidateWorkloadsCache({
      clusterUuid: "cluster-invalidate",
      workloadType: "services",
    });
    expect(removed).toBeGreaterThan(0);
    expect(
      window.localStorage.getItem(
        "dashboard.workloads.cache.v1:cluster-invalidate%3A%3Aservices%3A%3Aall%3A%3Aname",
      ),
    ).toBeNull();
    expect(window.localStorage.getItem(keepKey)).toBeTruthy();
    expect(listWorkloadEvents().some((event) => event.name === "workloads.cache_invalidated")).toBe(
      true,
    );
  });

  it("invalidates only the targeted cluster scope under multi-cluster cache pressure", async () => {
    vi.mocked(kubectlJson).mockImplementation(
      async (_cmd: string, options?: { clusterId?: string }) => ({
        items: [
          {
            metadata: {
              namespace: "default",
              name: `svc-${options?.clusterId ?? "unknown"}`,
            },
          },
        ],
      }),
    );

    const fetcher = useWorkloadsFetcher();
    for (let index = 0; index < 18; index += 1) {
      await fetcher.fetchWorkloads("services", "all", `cluster-scope-${index}`, "name");
    }

    const removed = invalidateWorkloadsCache({
      clusterUuid: "cluster-scope-7",
      workloadType: "services",
    });

    expect(removed).toBe(1);
    expect(
      window.localStorage.getItem(
        "dashboard.workloads.cache.v1:cluster-scope-7%3A%3Aservices%3A%3Aall%3A%3Aname",
      ),
    ).toBeNull();
    expect(
      window.localStorage.getItem(
        "dashboard.workloads.cache.v1:cluster-scope-6%3A%3Aservices%3A%3Aall%3A%3Aname",
      ),
    ).toBeTruthy();
    expect(
      window.localStorage.getItem(
        "dashboard.workloads.cache.v1:cluster-scope-17%3A%3Aservices%3A%3Aall%3A%3Aname",
      ),
    ).toBeTruthy();
  });

  it("evicts old in-memory cache entries when memory limit is reached", async () => {
    vi.mocked(kubectlJson).mockResolvedValue({
      items: [{ metadata: { namespace: "default", name: "svc-a" } }],
    });
    const fetcher = useWorkloadsFetcher();
    for (let i = 0; i < 165; i += 1) {
      await fetcher.fetchWorkloads("services", `ns-${i}`, "cluster-memory-eviction", "name");
    }
    expect(
      listWorkloadEvents().some((event) => event.name === "workloads.cache_memory_evict"),
    ).toBe(true);
  });

  it("evicts oversized snapshots from in-memory cache by byte budget", async () => {
    vi.mocked(kubectlJson).mockImplementation(
      async (_cmd: string, options?: { clusterId?: string }) => ({
        items: Array.from({ length: 320 }, (_, index) => ({
          metadata: {
            namespace: "default",
            name: `svc-${options?.clusterId ?? "unknown"}-${index}`,
            uid: `${options?.clusterId ?? "unknown"}-${index}`,
            resourceVersion: String(index),
          },
          spec: {
            selector: { app: `svc-${index}` },
            note: "x".repeat(4_000),
          },
          status: {
            phase: "Active",
            message: "y".repeat(1_500),
          },
        })),
      }),
    );

    const fetcher = useWorkloadsFetcher();
    for (let i = 0; i < 12; i += 1) {
      await fetcher.fetchWorkloads("services", "all", `cluster-byte-${i}`, "name");
    }

    const stats = __getWorkloadsFetcherMemoryCacheStatsForTests();
    expect(stats.entries).toBeLessThan(12);
    expect(stats.bytes).toBeLessThanOrEqual(12_000_000);
    expect(
      listWorkloadEvents().some(
        (event) =>
          event.name === "workloads.cache_memory_evict" &&
          (event.payload?.reason === "max_bytes" || event.payload?.reason === "max_entries"),
      ),
    ).toBe(true);
  });
});
