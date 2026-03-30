import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
}));

vi.mock("./get-cluster-info", () => ({
  loadClusterEntities: vi.fn(),
}));

import { loadClusterEntities } from "./get-cluster-info";
import { checkSecurityHardening } from "./check-security-hardening";

const mockedLoad = vi.mocked(loadClusterEntities);

function makeClusterData(overrides: Record<string, unknown> = {}) {
  return {
    status: "ok" as const,
    errors: undefined,
    deployments: { items: [] },
    statefulsets: { items: [] },
    daemonsets: { items: [] },
    jobs: { items: [] },
    namespaces: { items: [] },
    ...overrides,
  };
}

function makeNamespace(name: string, labels: Record<string, string> = {}) {
  return { metadata: { name, labels } };
}

function makeDeployment(name: string, namespace: string, podSpec: Record<string, unknown>) {
  return {
    metadata: { name, namespace },
    spec: { template: { spec: podSpec } },
  };
}

describe("checkSecurityHardening", () => {
  const clusterId = "cluster-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok when all containers are fully hardened", async () => {
    const data = makeClusterData({
      namespaces: {
        items: [
          makeNamespace("default", {
            "pod-security.kubernetes.io/enforce": "restricted",
          }),
        ],
      },
      deployments: {
        items: [
          makeDeployment("app", "default", {
            containers: [
              {
                name: "main",
                securityContext: {
                  runAsNonRoot: true,
                  allowPrivilegeEscalation: false,
                  readOnlyRootFilesystem: true,
                  seccompProfile: { type: "RuntimeDefault" },
                  capabilities: { drop: ["ALL"] },
                },
              },
            ],
          }),
        ],
      },
    });

    const result = await checkSecurityHardening(clusterId, {
      force: true,
      data: data as never,
    });

    expect(result.status).toBe("ok");
    expect(result.summary.total).toBe(1);
    expect(result.summary.ok).toBe(1);
    expect(result.summary.critical).toBe(0);
  });

  it("returns critical when container runs as root", async () => {
    const data = makeClusterData({
      namespaces: { items: [makeNamespace("default")] },
      deployments: {
        items: [
          makeDeployment("app", "default", {
            containers: [
              {
                name: "main",
                securityContext: {},
              },
            ],
          }),
        ],
      },
    });

    const result = await checkSecurityHardening(clusterId, {
      force: true,
      data: data as never,
    });

    expect(result.status).toBe("critical");
    expect(result.summary.critical).toBeGreaterThan(0);
    expect(result.items[0].issues.length).toBeGreaterThan(0);
  });

  it("flags privileged mode as critical", async () => {
    const data = makeClusterData({
      namespaces: { items: [makeNamespace("default")] },
      deployments: {
        items: [
          makeDeployment("app", "default", {
            containers: [
              {
                name: "main",
                securityContext: {
                  privileged: true,
                  runAsNonRoot: true,
                  allowPrivilegeEscalation: false,
                  readOnlyRootFilesystem: true,
                  seccompProfile: { type: "RuntimeDefault" },
                  capabilities: { drop: ["ALL"] },
                },
              },
            ],
          }),
        ],
      },
    });

    const result = await checkSecurityHardening(clusterId, {
      force: true,
      data: data as never,
    });

    expect(result.status).toBe("critical");
    expect(result.items[0].issues).toContain("privileged mode enabled.");
  });

  it("returns ok with empty workloads", async () => {
    const data = makeClusterData({
      namespaces: { items: [makeNamespace("default")] },
    });

    const result = await checkSecurityHardening(clusterId, {
      force: true,
      data: data as never,
    });

    expect(result.status).toBe("ok");
    expect(result.summary.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it("returns error status when data loading fails", async () => {
    const data = makeClusterData({
      status: "error",
      errors: "connection refused",
    });

    const result = await checkSecurityHardening(clusterId, {
      force: true,
      data: data as never,
    });

    expect(result.status).toBe("unreachable");
    expect(result.errors).toBeDefined();
  });

  it("returns unknown on thrown error", async () => {
    mockedLoad.mockRejectedValue(new Error("network failure"));

    const result = await checkSecurityHardening(clusterId, { force: true });

    expect(result.status).toBe("unknown");
    expect(result.errors).toBeDefined();
  });

  it("includes recommendations when issues found", async () => {
    const data = makeClusterData({
      namespaces: { items: [makeNamespace("default")] },
      deployments: {
        items: [
          makeDeployment("app", "default", {
            containers: [{ name: "main", securityContext: {} }],
          }),
        ],
      },
    });

    const result = await checkSecurityHardening(clusterId, {
      force: true,
      data: data as never,
    });

    expect(result.items[0].recommendations.length).toBeGreaterThan(0);
  });

  it("detects hostNetwork/hostPID/hostIPC issues", async () => {
    const data = makeClusterData({
      namespaces: { items: [makeNamespace("default")] },
      deployments: {
        items: [
          makeDeployment("app", "default", {
            hostNetwork: true,
            hostPID: true,
            hostIPC: true,
            containers: [
              {
                name: "main",
                securityContext: {
                  runAsNonRoot: true,
                  allowPrivilegeEscalation: false,
                  readOnlyRootFilesystem: true,
                  seccompProfile: { type: "RuntimeDefault" },
                  capabilities: { drop: ["ALL"] },
                },
              },
            ],
          }),
        ],
      },
    });

    const result = await checkSecurityHardening(clusterId, {
      force: true,
      data: data as never,
    });

    const issues = result.items[0].issues;
    expect(issues).toContain("hostNetwork enabled.");
    expect(issues).toContain("hostPID enabled.");
    expect(issues).toContain("hostIPC enabled.");
  });
});
