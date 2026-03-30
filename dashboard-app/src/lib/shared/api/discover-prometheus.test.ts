import { describe, it, expect, vi, beforeEach } from "vitest";
import { discoverPrometheusService } from "./discover-prometheus";
import * as kubectlProxy from "$shared/api/kubectl-proxy";
import type { BaseClusterData, ServiceItem } from "../model/clusters";

vi.mock("@/lib/shared/api/kubectl-proxy");

function createService(overrides: Partial<ServiceItem>): ServiceItem {
  return {
    metadata: {
      creationTimestamp: new Date(),
      name: "service",
      namespace: "default",
      labels: {},
      ...overrides.metadata,
    },
    spec: {
      type: "ClusterIP",
      ports: [
        {
          name: "http",
          port: 80,
          protocol: "TCP",
          targetPort: 80,
        },
      ],
      ...overrides.spec,
    },
  };
}

describe("discoverPrometheusService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when kubectlJson returns a string error", async () => {
    vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue("kubectl error");

    const result = await discoverPrometheusService("cluster-1");

    expect(result).toBeNull();
  });

  it("returns null when no services match Prometheus heuristics", async () => {
    const data: BaseClusterData<ServiceItem> = {
      items: [
        createService({
          metadata: { creationTimestamp: new Date(), name: "nginx", namespace: "default" },
        }),
      ],
    };

    vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue(data);

    const result = await discoverPrometheusService("cluster-1");

    expect(result).toBeNull();
  });

  it("detects Prometheus service by name and namespace", async () => {
    const data: BaseClusterData<ServiceItem> = {
      items: [
        createService({
          metadata: {
            creationTimestamp: new Date(),
            name: "prometheus",
            namespace: "monitoring",
          },
          spec: {
            type: "ClusterIP",
            ports: [
              {
                name: "web",
                port: 9090,
                protocol: "TCP",
                targetPort: 9090,
              },
            ],
          },
        }),
      ],
    };

    vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue(data);

    const result = await discoverPrometheusService("cluster-1");

    expect(result).toEqual({
      name: "prometheus",
      namespace: "monitoring",
      port: 9090,
    });
  });

  it("selects the highest scored Prometheus candidate", async () => {
    const lowScore = createService({
      metadata: {
        creationTimestamp: new Date(),
        name: "prometheus-operated",
        namespace: "monitoring",
      },
      spec: {
        type: "ClusterIP",
        ports: [
          {
            name: "http",
            port: 80,
            protocol: "TCP",
            targetPort: 80,
          },
        ],
      },
    });

    const highScore = createService({
      metadata: {
        creationTimestamp: new Date(),
        name: "kube-prometheus",
        namespace: "monitoring",
      },
      spec: {
        type: "ClusterIP",
        ports: [
          {
            name: "web",
            port: 9090,
            protocol: "TCP",
            targetPort: 9090,
          },
        ],
      },
    });

    const data: BaseClusterData<ServiceItem> = {
      items: [lowScore, highScore],
    };

    vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue(data);

    const result = await discoverPrometheusService("cluster-1");

    expect(result?.name).toBe("kube-prometheus");
    expect(result?.port).toBe(9090);
  });

  it("falls back to 'web' port name when port 9090 is not present", async () => {
    const data: BaseClusterData<ServiceItem> = {
      items: [
        createService({
          metadata: {
            creationTimestamp: new Date(),
            name: "prometheus",
            namespace: "monitoring",
          },
          spec: {
            type: "ClusterIP",
            ports: [
              {
                name: "web",
                port: 8080,
                protocol: "TCP",
                targetPort: 8080,
              },
            ],
          },
        }),
      ],
    };

    vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue(data);

    const result = await discoverPrometheusService("cluster-1");

    expect(result?.port).toBe(8080);
  });

  it("defaults namespace to 'default' when metadata.namespace is missing", async () => {
    const data: BaseClusterData<ServiceItem> = {
      items: [
        createService({
          metadata: {
            creationTimestamp: new Date(),
            name: "prometheus",
            namespace: undefined,
          },
        }),
      ],
    };

    vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue(data);

    const result = await discoverPrometheusService("cluster-1");

    expect(result?.namespace).toBe("default");
  });
});
