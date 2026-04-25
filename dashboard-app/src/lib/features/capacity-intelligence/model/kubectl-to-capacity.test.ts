import { describe, expect, it } from "vitest";
import {
  aggregateByNamespace,
  joinWorkloadMetrics,
  nodeUsageFromMetrics,
  nodesFromJson,
  podRequestsFromJson,
  podUsageFromMetrics,
  podsOnNodesFromJson,
  workloadFromOwners,
} from "./kubectl-to-capacity";

describe("workloadFromOwners", () => {
  it("strips the ReplicaSet hash suffix to expose the Deployment name", () => {
    const result = workloadFromOwners(
      [{ kind: "ReplicaSet", name: "web-7d6b89c4f8" }],
      "web-7d6b89c4f8-abc12",
    );
    expect(result).toEqual({ kind: "Deployment", name: "web" });
  });

  it("returns StatefulSet and DaemonSet owners directly", () => {
    expect(workloadFromOwners([{ kind: "StatefulSet", name: "db" }], "db-0")).toEqual({
      kind: "StatefulSet",
      name: "db",
    });
    expect(workloadFromOwners([{ kind: "DaemonSet", name: "fluent" }], "fluent-xyz")).toEqual({
      kind: "DaemonSet",
      name: "fluent",
    });
  });

  it("falls back to the pod name when there is no owner (static pod)", () => {
    expect(workloadFromOwners(undefined, "kube-apiserver-cp0")).toEqual({
      kind: "Pod",
      name: "kube-apiserver-cp0",
    });
    expect(workloadFromOwners([], "kube-apiserver-cp0")).toEqual({
      kind: "Pod",
      name: "kube-apiserver-cp0",
    });
  });
});

describe("podRequestsFromJson", () => {
  it("reads container cpu/memory requests and resolves the owning workload", () => {
    const result = podRequestsFromJson({
      items: [
        {
          metadata: {
            name: "web-abc",
            namespace: "shop",
            ownerReferences: [{ kind: "ReplicaSet", name: "web-7d6b89c4f8" }],
          },
          spec: {
            containers: [
              {
                name: "app",
                resources: { requests: { cpu: "500m", memory: "256Mi" } },
              },
            ],
          },
        },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      namespace: "shop",
      name: "web-abc",
      owner: { kind: "Deployment", name: "web" },
    });
    expect(result[0]?.containers[0]?.cpuMillicores).toBe(500);
    expect(result[0]?.containers[0]?.memoryMiB).toBe(256);
  });

  it("skips items missing name or namespace (malformed response)", () => {
    const result = podRequestsFromJson({
      items: [
        { spec: { containers: [{ name: "c" }] } },
        { metadata: { name: "only-name" }, spec: { containers: [{ name: "c" }] } },
      ],
    });
    expect(result).toHaveLength(0);
  });
});

describe("podUsageFromMetrics", () => {
  it("maps metrics.k8s.io PodMetricsList items", () => {
    const result = podUsageFromMetrics({
      items: [
        {
          metadata: { name: "web-abc", namespace: "shop" },
          containers: [{ name: "app", usage: { cpu: "120m", memory: "200Mi" } }],
        },
      ],
    });
    expect(result[0]?.containers[0]).toEqual({
      name: "app",
      cpuMillicores: 120,
      memoryMiB: 200,
    });
  });
});

describe("joinWorkloadMetrics", () => {
  it("rolls pod-level requests/usage up to the workload level", () => {
    const requests = podRequestsFromJson({
      items: [
        {
          metadata: {
            name: "web-abc-1",
            namespace: "shop",
            ownerReferences: [{ kind: "ReplicaSet", name: "web-7d6b89c4f8" }],
          },
          spec: {
            containers: [
              { name: "app", resources: { requests: { cpu: "100m", memory: "128Mi" } } },
            ],
          },
        },
        {
          metadata: {
            name: "web-abc-2",
            namespace: "shop",
            ownerReferences: [{ kind: "ReplicaSet", name: "web-7d6b89c4f8" }],
          },
          spec: {
            containers: [
              { name: "app", resources: { requests: { cpu: "100m", memory: "128Mi" } } },
            ],
          },
        },
      ],
    });
    const usage = podUsageFromMetrics({
      items: [
        {
          metadata: { name: "web-abc-1", namespace: "shop" },
          containers: [{ name: "app", usage: { cpu: "50m", memory: "80Mi" } }],
        },
        {
          metadata: { name: "web-abc-2", namespace: "shop" },
          containers: [{ name: "app", usage: { cpu: "60m", memory: "90Mi" } }],
        },
      ],
    });
    const result = joinWorkloadMetrics(requests, usage);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      namespace: "shop",
      workload: "web",
      workloadType: "Deployment",
      cpuRequestMillicores: 200,
      cpuUsageMillicores: 110,
      memoryRequestMiB: 256,
      memoryUsageMiB: 170,
    });
  });

  it("treats missing usage samples as zero (metrics-server not yet reporting)", () => {
    const requests = podRequestsFromJson({
      items: [
        {
          metadata: {
            name: "p",
            namespace: "ns",
            ownerReferences: [{ kind: "StatefulSet", name: "db" }],
          },
          spec: { containers: [{ name: "c", resources: { requests: { cpu: "100m" } } }] },
        },
      ],
    });
    const result = joinWorkloadMetrics(requests, []);
    expect(result[0]?.cpuUsageMillicores).toBe(0);
  });
});

describe("aggregateByNamespace", () => {
  it("sums workload metrics into namespace totals", () => {
    const result = aggregateByNamespace([
      {
        namespace: "shop",
        workload: "web",
        workloadType: "Deployment",
        cpuRequestMillicores: 200,
        cpuUsageMillicores: 110,
        memoryRequestMiB: 256,
        memoryUsageMiB: 170,
      },
      {
        namespace: "shop",
        workload: "api",
        workloadType: "Deployment",
        cpuRequestMillicores: 300,
        cpuUsageMillicores: 200,
        memoryRequestMiB: 512,
        memoryUsageMiB: 400,
      },
      {
        namespace: "infra",
        workload: "db",
        workloadType: "StatefulSet",
        cpuRequestMillicores: 1000,
        cpuUsageMillicores: 400,
        memoryRequestMiB: 2048,
        memoryUsageMiB: 800,
      },
    ]);
    expect(result).toHaveLength(2);
    const shop = result.find((r) => r.namespace === "shop");
    expect(shop).toMatchObject({
      cpuRequestMillicores: 500,
      cpuUsageMillicores: 310,
      memoryRequestMiB: 768,
      memoryUsageMiB: 570,
    });
  });
});

describe("nodesFromJson", () => {
  it("uses allocatable and sums requests per node", () => {
    const nodes = nodesFromJson(
      {
        items: [
          {
            metadata: { name: "n1" },
            status: { allocatable: { cpu: "4", memory: "8Gi" } },
          },
        ],
      },
      [
        { nodeName: "n1", cpuRequestMillicores: 1000, memoryRequestMiB: 1024 },
        { nodeName: "n1", cpuRequestMillicores: 500, memoryRequestMiB: 512 },
      ],
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      name: "n1",
      allocatableCpuMillicores: 4000,
      allocatableMemoryMiB: 8192,
      requestedCpuMillicores: 1500,
      requestedMemoryMiB: 1536,
    });
  });

  it("falls back to capacity when allocatable is missing (older API servers)", () => {
    const nodes = nodesFromJson(
      {
        items: [
          {
            metadata: { name: "n1" },
            status: { capacity: { cpu: "2", memory: "4Gi" } },
          },
        ],
      },
      [],
    );
    expect(nodes[0]?.allocatableCpuMillicores).toBe(2000);
    expect(nodes[0]?.allocatableMemoryMiB).toBe(4096);
  });
});

describe("podsOnNodesFromJson", () => {
  it("skips pending pods without nodeName", () => {
    const result = podsOnNodesFromJson({
      items: [
        { spec: { containers: [{ name: "c" }] } },
        {
          spec: {
            nodeName: "n1",
            containers: [{ name: "c", resources: { requests: { cpu: "100m" } } }],
          },
        },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.nodeName).toBe("n1");
  });
});

describe("nodeUsageFromMetrics", () => {
  it("returns a map keyed by node name with parsed usage", () => {
    const result = nodeUsageFromMetrics({
      items: [
        { metadata: { name: "n1" }, usage: { cpu: "250m", memory: "1Gi" } },
        { metadata: { name: "n2" }, usage: { cpu: "1500m", memory: "3Gi" } },
      ],
    });
    expect(result.get("n1")).toEqual({ cpuMillicores: 250, memoryMiB: 1024 });
    expect(result.get("n2")).toEqual({ cpuMillicores: 1500, memoryMiB: 3072 });
  });
});
