import { describe, expect, it } from "vitest";
import { buildDependencyGraph } from "./model";

describe("workload-visualizer", () => {
  it("builds graph from ingress -> service -> deployment -> pod chain", () => {
    const graph = buildDependencyGraph({
      ingresses: [
        {
          metadata: { name: "web-ing", namespace: "prod" },
          spec: {
            rules: [{ http: { paths: [{ backend: { service: { name: "web-svc" } } }] } }],
            tls: [{ secretName: "web-tls" }],
          },
        },
      ],
      services: [
        {
          metadata: { name: "web-svc", namespace: "prod" },
          spec: { selector: { app: "web" } },
        },
      ],
      deployments: [
        {
          metadata: { name: "web-deploy", namespace: "prod", labels: { app: "web" } },
          spec: { replicas: 3, template: { metadata: { labels: { app: "web" } } } },
          status: { readyReplicas: 3 },
        },
      ],
      pods: [
        {
          metadata: {
            name: "web-pod-1",
            namespace: "prod",
            // @ts-expect-error partial fixture
            ownerReferences: [{ kind: "ReplicaSet", name: "web-deploy-abc" }],
          },
          spec: {
            serviceAccountName: "web-sa",
            volumes: [
              { configMap: { name: "web-config" } },
              { secret: { secretName: "db-creds" } },
            ],
          },
          status: { phase: "Running" },
        },
      ],
      secrets: [
        { metadata: { name: "web-tls", namespace: "prod" } },
        { metadata: { name: "db-creds", namespace: "prod" } },
      ],
      configmaps: [{ metadata: { name: "web-config", namespace: "prod" } }],
      serviceaccounts: [{ metadata: { name: "web-sa", namespace: "prod" } }],
    });

    expect(graph.nodes.length).toBeGreaterThanOrEqual(7);
    expect(graph.edges.length).toBeGreaterThanOrEqual(4);

    // Ingress -> Service
    expect(
      graph.edges.some(
        (e) => e.label === "routes" && e.source.includes("Ingress") && e.target.includes("Service"),
      ),
    ).toBe(true);
    // Ingress -> TLS Secret
    expect(graph.edges.some((e) => e.label === "TLS cert" && e.target.includes("web-tls"))).toBe(
      true,
    );
    // Service -> Deployment
    expect(
      graph.edges.some(
        (e) =>
          e.type === "selects" && e.source.includes("Service") && e.target.includes("Deployment"),
      ),
    ).toBe(true);
    // Pod -> ConfigMap
    expect(graph.edges.some((e) => e.label === "mounts" && e.target.includes("ConfigMap"))).toBe(
      true,
    );
    // Pod -> Secret
    expect(
      graph.edges.some((e) => e.label === "mounts" && e.target.includes("Secret/prod/db-creds")),
    ).toBe(true);
    // Pod -> ServiceAccount
    expect(
      graph.edges.some((e) => e.label === "runs as" && e.target.includes("ServiceAccount")),
    ).toBe(true);
  });

  it("detects pod status from phase", () => {
    const graph = buildDependencyGraph({
      pods: [
        { metadata: { name: "running", namespace: "ns" }, spec: {}, status: { phase: "Running" } },
        { metadata: { name: "pending", namespace: "ns" }, spec: {}, status: { phase: "Pending" } },
        { metadata: { name: "failed", namespace: "ns" }, spec: {}, status: { phase: "Failed" } },
      ],
    });

    const running = graph.nodes.find((n) => n.name === "running");
    const pending = graph.nodes.find((n) => n.name === "pending");
    const failed = graph.nodes.find((n) => n.name === "failed");
    expect(running?.status).toBe("healthy");
    expect(pending?.status).toBe("warning");
    expect(failed?.status).toBe("error");
  });

  it("detects deployment with missing replicas as warning", () => {
    const graph = buildDependencyGraph({
      deployments: [
        {
          metadata: { name: "degraded", namespace: "ns" },
          spec: { replicas: 3, template: { metadata: { labels: {} } } },
          status: { readyReplicas: 1 },
        },
      ],
    });

    expect(graph.nodes.find((n) => n.name === "degraded")?.status).toBe("warning");
  });

  it("connects HPA to deployment", () => {
    const graph = buildDependencyGraph({
      deployments: [
        {
          metadata: { name: "api", namespace: "ns" },
          spec: { template: { metadata: { labels: {} } } },
        },
      ],
      hpas: [
        {
          metadata: { name: "api-hpa", namespace: "ns" },
          spec: { scaleTargetRef: { kind: "Deployment", name: "api" } },
        },
      ],
    });

    expect(
      graph.edges.some(
        (e) => e.type === "scales" && e.source.includes("HPA") && e.target.includes("Deployment"),
      ),
    ).toBe(true);
  });

  it("reports orphaned nodes", () => {
    const graph = buildDependencyGraph({
      configmaps: [{ metadata: { name: "unused", namespace: "ns" } }],
      secrets: [{ metadata: { name: "unused-secret", namespace: "ns" } }],
    });

    expect(graph.summary.orphanedNodes).toBe(2);
    expect(graph.summary.warnings.length).toBeGreaterThan(0);
  });

  it("handles empty input", () => {
    const graph = buildDependencyGraph({});
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it("builds summary by kind", () => {
    const graph = buildDependencyGraph({
      pods: [
        { metadata: { name: "p1", namespace: "ns" }, spec: {}, status: {} },
        { metadata: { name: "p2", namespace: "ns" }, spec: {}, status: {} },
      ],
      services: [{ metadata: { name: "s1", namespace: "ns" }, spec: {} }],
    });

    expect(graph.summary.byKind["Pod"]).toBe(2);
    expect(graph.summary.byKind["Service"]).toBe(1);
  });
});
