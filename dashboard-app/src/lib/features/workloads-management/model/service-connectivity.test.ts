import { describe, expect, it } from "vitest";
import { buildServiceTopology } from "./service-connectivity";

describe("service-connectivity", () => {
  it("maps service → endpointslice → pod", () => {
    const result = buildServiceTopology({
      services: [{ metadata: { name: "web", namespace: "default" }, spec: {} }],
      endpointSlices: [
        {
          metadata: {
            name: "web-abc",
            namespace: "default",
            labels: { "kubernetes.io/service-name": "web" },
          },
          endpoints: [
            { conditions: { ready: true }, targetRef: { name: "web-pod-1", kind: "Pod" } },
          ],
        },
      ],
      pods: [
        { metadata: { name: "web-pod-1", namespace: "default" }, status: { phase: "Running" } },
      ],
    });
    expect(result.services).toBe(1);
    expect(result.endpoints).toBe(1);
    expect(result.pods).toBe(1);
    expect(result.edges.length).toBeGreaterThanOrEqual(2);
    expect(result.healthyPercent).toBe(100);
  });

  it("detects unhealthy pods", () => {
    const result = buildServiceTopology({
      services: [{ metadata: { name: "api", namespace: "ns" } }],
      endpointSlices: [
        {
          metadata: {
            name: "api-eps",
            namespace: "ns",
            labels: { "kubernetes.io/service-name": "api" },
          },
          endpoints: [{ conditions: { ready: false }, targetRef: { name: "api-1" } }],
        },
      ],
      pods: [{ metadata: { name: "api-1", namespace: "ns" }, status: { phase: "Pending" } }],
    });
    expect(result.healthyPercent).toBe(0);
  });
});
