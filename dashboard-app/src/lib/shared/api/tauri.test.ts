import { describe, expect, it, vi, beforeEach } from "vitest";

const kubectlJson = vi.fn();
const kubectlRawFront = vi.fn();

vi.mock("./kubectl-proxy", () => ({
  kubectlJson,
  kubectlRawFront,
}));

describe("getClusterEntityInfo", () => {
  beforeEach(() => {
    kubectlJson.mockReset();
    kubectlRawFront.mockReset();
  });

  it("returns the transport error instead of masking it behind a timeout for unreachable clusters", async () => {
    kubectlRawFront.mockResolvedValue({
      output: "",
      errors:
        "Unable to connect to the server: dial tcp 192.168.49.2:8443: connect: no route to host",
      code: 1,
    });

    const { getClusterEntityInfo } = await import("./tauri");
    const result = await getClusterEntityInfo("nodes", "cluster-a");

    expect(result).toEqual({
      entity: "nodes",
      data: "Unable to connect to the server: dial tcp 192.168.49.2:8443: connect: no route to host",
      status: "error",
      error:
        "Unable to connect to the server: dial tcp 192.168.49.2:8443: connect: no route to host",
    });
    expect(kubectlRawFront).toHaveBeenCalledTimes(1);
  });

  it("aborts the underlying kubectl call when the entity request times out", async () => {
    vi.useFakeTimers();
    kubectlRawFront.mockImplementation(
      (_command: string, options?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Kubectl request aborted", "AbortError"));
          });
        }),
    );

    const { getClusterEntityInfo } = await import("./tauri");
    const pending = getClusterEntityInfo("nodes", "cluster-a", 10_000);

    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending;

    expect(result).toEqual({
      entity: "nodes",
      data: "",
      status: "error",
      error: "Timeout after 10000ms for nodes",
    });
    const firstCallSignal = kubectlRawFront.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(firstCallSignal.aborted).toBe(true);
    expect(kubectlRawFront).toHaveBeenCalledTimes(2);
    const secondCallSignal = kubectlRawFront.mock.calls[1]?.[1]?.signal as AbortSignal;
    expect(secondCallSignal.aborted).toBe(true);

    vi.useRealTimers();
  }, 10_000);

  it("uses lightweight entity commands for dashboard refreshes", async () => {
    kubectlRawFront.mockResolvedValue({
      output: "default pod-a\nkube-system pod-b\n",
      errors: "",
      code: 0,
    });

    const { getClusterEntityInfo } = await import("./tauri");
    const result = await getClusterEntityInfo("pods", "cluster-a", undefined, undefined, {
      lightweight: true,
    });

    expect(kubectlRawFront).toHaveBeenCalledWith(
      "get pods --all-namespaces --no-headers -o custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name",
      expect.objectContaining({ clusterId: "cluster-a" }),
    );
    expect(result).toEqual({
      entity: "pods",
      status: "ok",
      data: {
        items: [
          { metadata: { namespace: "default", name: "pod-a" } },
          { metadata: { namespace: "kube-system", name: "pod-b" } },
        ],
      },
    });
  });

  it("uses lightweight node commands for dashboard refreshes", async () => {
    kubectlRawFront.mockResolvedValue({
      output: "node-a True False False False False\nnode-b False True False False False\n",
      errors: "",
      code: 0,
    });

    const { getClusterEntityInfo } = await import("./tauri");
    const result = await getClusterEntityInfo("nodes", "cluster-a", undefined, undefined, {
      lightweight: true,
    });

    expect(kubectlRawFront).toHaveBeenCalledWith(
      'get nodes --no-headers -o custom-columns=NAME:.metadata.name,READY:.status.conditions[?(@.type=="Ready")].status,DISK:.status.conditions[?(@.type=="DiskPressure")].status,MEMORY:.status.conditions[?(@.type=="MemoryPressure")].status,PID:.status.conditions[?(@.type=="PIDPressure")].status,NETWORK:.status.conditions[?(@.type=="NetworkUnavailable")].status',
      expect.objectContaining({ clusterId: "cluster-a" }),
    );
    expect(result).toEqual({
      entity: "nodes",
      status: "ok",
      data: {
        items: [
          {
            metadata: { name: "node-a" },
            status: {
              conditions: [
                { type: "Ready", status: "True" },
                { type: "DiskPressure", status: "False" },
                { type: "MemoryPressure", status: "False" },
                { type: "PIDPressure", status: "False" },
                { type: "NetworkUnavailable", status: "False" },
              ],
            },
          },
          {
            metadata: { name: "node-b" },
            status: {
              conditions: [
                { type: "Ready", status: "False" },
                { type: "DiskPressure", status: "True" },
                { type: "MemoryPressure", status: "False" },
                { type: "PIDPressure", status: "False" },
                { type: "NetworkUnavailable", status: "False" },
              ],
            },
          },
        ],
      },
    });
  });
});

describe("getClusterFastDashboardEntities", () => {
  beforeEach(() => {
    kubectlJson.mockReset();
    kubectlRawFront.mockReset();
  });

  it("loads pods, deployments, and replicasets with one kubectl call", async () => {
    kubectlRawFront.mockResolvedValue({
      output: [
        "Pod default pod-a",
        "Deployment default deploy-a",
        "ReplicaSet default rs-a",
        "Pod kube-system pod-b",
      ].join("\n"),
      errors: "",
      code: 0,
    });

    const { getClusterFastDashboardEntities } = await import("./tauri");
    const result = await getClusterFastDashboardEntities("cluster-a");

    expect(kubectlRawFront).toHaveBeenCalledWith(
      "get pods,deployments,replicasets --all-namespaces --no-headers -o custom-columns=KIND:.kind,NAMESPACE:.metadata.namespace,NAME:.metadata.name",
      expect.objectContaining({ clusterId: "cluster-a" }),
    );
    expect(result).toEqual({
      pods: {
        items: [
          { metadata: { namespace: "default", name: "pod-a" } },
          { metadata: { namespace: "kube-system", name: "pod-b" } },
        ],
      },
      deployments: {
        items: [{ metadata: { namespace: "default", name: "deploy-a" } }],
      },
      replicasets: {
        items: [{ metadata: { namespace: "default", name: "rs-a" } }],
      },
    });
  });
});

describe("parseCombinedSlowDashboardEntityOutput", () => {
  it("splits output lines into daemonsets, statefulsets, jobs, and cronjobs", async () => {
    const { parseCombinedSlowDashboardEntityOutput } = await import("./tauri");
    const output = [
      "DaemonSet kube-system fluentd",
      "StatefulSet default postgres-0",
      "Job default migration-job",
      "CronJob default nightly-backup",
      "DaemonSet kube-system node-exporter",
      "StatefulSet monitoring prometheus",
      "Job batch data-import",
    ].join("\n");

    const result = parseCombinedSlowDashboardEntityOutput(output);

    expect(result).toEqual({
      daemonsets: {
        items: [
          { metadata: { namespace: "kube-system", name: "fluentd" } },
          { metadata: { namespace: "kube-system", name: "node-exporter" } },
        ],
      },
      statefulsets: {
        items: [
          { metadata: { namespace: "default", name: "postgres-0" } },
          { metadata: { namespace: "monitoring", name: "prometheus" } },
        ],
      },
      jobs: {
        items: [
          { metadata: { namespace: "default", name: "migration-job" } },
          { metadata: { namespace: "batch", name: "data-import" } },
        ],
      },
      cronjobs: {
        items: [{ metadata: { namespace: "default", name: "nightly-backup" } }],
      },
    });
  });

  it("returns empty collections for empty output", async () => {
    const { parseCombinedSlowDashboardEntityOutput } = await import("./tauri");

    const result = parseCombinedSlowDashboardEntityOutput("");

    expect(result).toEqual({
      daemonsets: { items: [] },
      statefulsets: { items: [] },
      jobs: { items: [] },
      cronjobs: { items: [] },
    });
  });

  it("ignores unknown kind values", async () => {
    const { parseCombinedSlowDashboardEntityOutput } = await import("./tauri");
    const output = "UnknownKind default something\nDaemonSet kube-system fluentd\n";

    const result = parseCombinedSlowDashboardEntityOutput(output);

    expect(result.daemonsets.items).toHaveLength(1);
    expect(result.statefulsets.items).toHaveLength(0);
    expect(result.jobs.items).toHaveLength(0);
    expect(result.cronjobs.items).toHaveLength(0);
  });
});

describe("getClusterSlowDashboardEntities", () => {
  beforeEach(() => {
    kubectlJson.mockReset();
    kubectlRawFront.mockReset();
  });

  it("loads daemonsets, statefulsets, jobs, and cronjobs with one kubectl call", async () => {
    kubectlRawFront.mockResolvedValue({
      output: [
        "DaemonSet kube-system fluentd",
        "StatefulSet default postgres",
        "Job default migration",
        "CronJob default backup",
      ].join("\n"),
      errors: "",
      code: 0,
    });

    const { getClusterSlowDashboardEntities } = await import("./tauri");
    const result = await getClusterSlowDashboardEntities("cluster-a");

    expect(kubectlRawFront).toHaveBeenCalledWith(
      "get daemonsets,statefulsets,jobs,cronjobs --all-namespaces --no-headers -o custom-columns=KIND:.kind,NAMESPACE:.metadata.namespace,NAME:.metadata.name",
      expect.objectContaining({ clusterId: "cluster-a" }),
    );
    expect(result).toEqual({
      daemonsets: {
        items: [{ metadata: { namespace: "kube-system", name: "fluentd" } }],
      },
      statefulsets: {
        items: [{ metadata: { namespace: "default", name: "postgres" } }],
      },
      jobs: {
        items: [{ metadata: { namespace: "default", name: "migration" } }],
      },
      cronjobs: {
        items: [{ metadata: { namespace: "default", name: "backup" } }],
      },
    });
  });
});
