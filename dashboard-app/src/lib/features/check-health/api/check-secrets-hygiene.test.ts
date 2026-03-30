import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
}));

vi.mock("./get-cluster-info", () => ({
  loadClusterEntities: vi.fn(),
}));

import { loadClusterEntities } from "./get-cluster-info";
import { checkSecretsHygiene } from "./check-secrets-hygiene";
import type { ClusterData } from "$shared/model/clusters";

const mockedLoad = vi.mocked(loadClusterEntities);

function makeClusterData(overrides: Partial<ClusterData> = {}): ClusterData {
  return {
    uuid: "cluster-1",
    name: "test",
    status: "ok",
    pods: { items: [] },
    deployments: { items: [] },
    replicasets: { items: [] },
    cronjobs: { items: [] },
    configmaps: { items: [] },
    nodes: { items: [] },
    namespaces: { items: [] },
    daemonsets: { items: [] },
    statefulsets: { items: [] },
    jobs: { items: [] },
    networkpolicies: { items: [] },
    poddisruptionbudgets: { items: [] },
    priorityclasses: { items: [] },
    secrets: { items: [] },
    ...overrides,
  } as ClusterData;
}

describe("checkSecretsHygiene", () => {
  const clusterId = "cluster-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok when configmaps contain no secrets", async () => {
    const data = makeClusterData({
      configmaps: {
        items: [
          {
            metadata: { name: "app-config", namespace: "default" },
            data: { LOG_LEVEL: "info", PORT: "8080" },
          },
        ],
      } as any,
    });

    const result = await checkSecretsHygiene(clusterId, { force: true, data });

    expect(result.status).toBe("ok");
    expect(result.items).toHaveLength(0);
    expect(result.encryptionStatus).toBe("unknown");
  });

  it("returns warning when configmap has suspicious key names", async () => {
    const data = makeClusterData({
      configmaps: {
        items: [
          {
            metadata: { name: "bad-config", namespace: "default" },
            data: { DB_PASSWORD: "short" },
          },
        ],
      } as any,
    });

    const result = await checkSecretsHygiene(clusterId, { force: true, data });

    expect(result.status).toBe("warning");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].configMap).toBe("bad-config");
    expect(result.items[0].key).toBe("DB_PASSWORD");
    expect(result.items[0].issues.some((i) => i.includes("secret"))).toBe(true);
  });

  it("returns critical when configmap value contains a private key", async () => {
    const data = makeClusterData({
      configmaps: {
        items: [
          {
            metadata: { name: "certs-config", namespace: "default" },
            data: {
              TLS_KEY: "-----BEGIN RSA PRIVATE KEY-----\nMIIE...",
            },
          },
        ],
      } as any,
    });

    const result = await checkSecretsHygiene(clusterId, { force: true, data });

    expect(result.status).toBe("critical");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].status).toBe("critical");
    expect(result.items[0].issues.some((i) => i.includes("private key"))).toBe(true);
  });

  it("returns critical when configmap value contains a JWT token", async () => {
    const data = makeClusterData({
      configmaps: {
        items: [
          {
            metadata: { name: "auth-config", namespace: "default" },
            data: {
              AUTH_TOKEN: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.something",
            },
          },
        ],
      } as any,
    });

    const result = await checkSecretsHygiene(clusterId, { force: true, data });

    expect(result.status).toBe("critical");
    expect(result.items.some((i) => i.issues.some((issue) => issue.includes("JWT")))).toBe(true);
  });

  it("returns ok with empty configmaps", async () => {
    const data = makeClusterData({
      configmaps: { items: [] } as any,
    });

    const result = await checkSecretsHygiene(clusterId, { force: true, data });

    expect(result.status).toBe("ok");
    expect(result.items).toHaveLength(0);
  });

  it("returns error status when data loading fails", async () => {
    const data = makeClusterData({
      status: "error",
      errors: "connection refused",
    });

    const result = await checkSecretsHygiene(clusterId, { force: true, data });

    expect(result.status).toBe("unreachable");
    expect(result.errors).toBeDefined();
  });

  it("returns unknown on thrown error", async () => {
    mockedLoad.mockRejectedValue(new Error("network failure"));

    const result = await checkSecretsHygiene(clusterId, { force: true });

    expect(result.status).toBe("unknown");
    expect(result.errors).toBeDefined();
  });

  it("returns insufficient when error contains forbidden", async () => {
    const data = makeClusterData({
      status: "error",
      errors: "forbidden: User cannot list configmaps",
    });

    const result = await checkSecretsHygiene(clusterId, { force: true, data });

    expect(result.status).toBe("insufficient");
  });

  it("flags warning for base64-like values", async () => {
    const data = makeClusterData({
      configmaps: {
        items: [
          {
            metadata: { name: "encoded-config", namespace: "default" },
            data: {
              ENCODED_VALUE: "dGhpcyBpcyBhIGxvbmcgYmFzZTY0IGVuY29kZWQgdmFsdWUgdGhhdCBpcyBsb25n",
            },
          },
        ],
      } as any,
    });

    const result = await checkSecretsHygiene(clusterId, { force: true, data });

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].issues.some((i) => i.includes("base64"))).toBe(true);
  });
});
