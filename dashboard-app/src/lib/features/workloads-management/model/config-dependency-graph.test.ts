import { describe, expect, it } from "vitest";
import { buildConfigDependencyGraph } from "./config-dependency-graph";

describe("config-dependency-graph", () => {
  const pod = (
    name: string,
    namespace: string,
    spec: Record<string, unknown>,
    owner?: { kind: string; name: string },
  ) => ({
    metadata: {
      name,
      namespace,
      ...(owner ? { ownerReferences: [{ kind: owner.kind, name: owner.name }] } : {}),
    },
    spec,
  });

  it("detects configmap volume mount", () => {
    const pods = [
      pod(
        "web-abc",
        "default",
        {
          volumes: [{ configMap: { name: "app-config" } }],
          containers: [],
        },
        { kind: "ReplicaSet", name: "web" },
      ),
    ];
    const result = buildConfigDependencyGraph("ConfigMap", "app-config", "default", pods);
    expect(result.consumers).toHaveLength(1);
    expect(result.consumers[0]).toEqual({
      kind: "ReplicaSet",
      name: "web",
      namespace: "default",
      refType: "volume",
    });
    expect(result.orphan).toBe(false);
  });

  it("detects secret envFrom reference", () => {
    const pods = [
      pod("api-xyz", "prod", {
        containers: [{ envFrom: [{ secretRef: { name: "db-creds" } }] }],
        volumes: [],
      }),
    ];
    const result = buildConfigDependencyGraph("Secret", "db-creds", "prod", pods);
    expect(result.consumers).toHaveLength(1);
    expect(result.consumers[0].refType).toBe("envFrom");
  });

  it("detects env valueFrom configMapKeyRef", () => {
    const pods = [
      pod("worker-1", "default", {
        containers: [
          {
            env: [{ valueFrom: { configMapKeyRef: { name: "feature-flags", key: "ENABLE_V2" } } }],
          },
        ],
        volumes: [],
      }),
    ];
    const result = buildConfigDependencyGraph("ConfigMap", "feature-flags", "default", pods);
    expect(result.consumers).toHaveLength(1);
    expect(result.consumers[0].refType).toBe("env");
  });

  it("detects projected volume source", () => {
    const pods = [
      pod("svc-1", "default", {
        volumes: [
          {
            projected: {
              sources: [{ configMap: { name: "shared-config" } }],
            },
          },
        ],
        containers: [],
      }),
    ];
    const result = buildConfigDependencyGraph("ConfigMap", "shared-config", "default", pods);
    expect(result.consumers).toHaveLength(1);
    expect(result.consumers[0].refType).toBe("projected");
  });

  it("marks orphan when no consumers", () => {
    const result = buildConfigDependencyGraph("ConfigMap", "unused-config", "default", []);
    expect(result.orphan).toBe(true);
    expect(result.consumers).toHaveLength(0);
  });

  it("deduplicates consumers by owner", () => {
    const pods = [
      pod(
        "web-1",
        "default",
        {
          volumes: [{ configMap: { name: "app-config" } }],
          containers: [{ envFrom: [{ configMapRef: { name: "app-config" } }] }],
        },
        { kind: "ReplicaSet", name: "web" },
      ),
      pod(
        "web-2",
        "default",
        {
          volumes: [{ configMap: { name: "app-config" } }],
          containers: [],
        },
        { kind: "ReplicaSet", name: "web" },
      ),
    ];
    const result = buildConfigDependencyGraph("ConfigMap", "app-config", "default", pods);
    // web ReplicaSet: volume + envFrom = 2 unique refTypes from same owner
    expect(result.consumers).toHaveLength(2);
  });

  it("ignores pods from other namespaces", () => {
    const pods = [
      pod("web-1", "staging", {
        volumes: [{ configMap: { name: "app-config" } }],
        containers: [],
      }),
    ];
    const result = buildConfigDependencyGraph("ConfigMap", "app-config", "default", pods);
    expect(result.consumers).toHaveLength(0);
  });

  it("detects imagePullSecrets", () => {
    const pods = [
      pod("app-1", "default", {
        imagePullSecrets: [{ name: "registry-creds" }],
        containers: [],
        volumes: [],
      }),
    ];
    const result = buildConfigDependencyGraph("Secret", "registry-creds", "default", pods);
    expect(result.consumers).toHaveLength(1);
  });
});
