import { beforeEach, describe, expect, it, vi } from "vitest";

const loadClusterEntitiesMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("./get-cluster-info", () => ({
  loadClusterEntities: loadClusterEntitiesMock,
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  error: logErrorMock,
}));

function makeClusterData(overrides: Record<string, unknown> = {}) {
  return {
    status: "ok",
    errors: undefined,
    deployments: { items: [] },
    statefulsets: { items: [] },
    daemonsets: { items: [] },
    ...overrides,
  };
}

function makeDeployment(
  name: string,
  namespace: string,
  containers: Array<{
    name: string;
    readinessProbe?: Record<string, unknown>;
    livenessProbe?: Record<string, unknown>;
    startupProbe?: Record<string, unknown>;
  }>,
) {
  return {
    metadata: { name, namespace },
    spec: {
      template: { spec: { containers } },
    },
  };
}

describe("check-probes-health", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    loadClusterEntitiesMock.mockReset();
    logErrorMock.mockReset();
  });

  it("returns ok when all containers have proper probes", async () => {
    const data = makeClusterData({
      deployments: {
        items: [
          makeDeployment("web", "default", [
            {
              name: "main",
              readinessProbe: { httpGet: { path: "/ready", port: 8080 }, initialDelaySeconds: 10 },
              livenessProbe: {
                httpGet: { path: "/health", port: 8080 },
                initialDelaySeconds: 15,
                timeoutSeconds: 5,
                failureThreshold: 3,
              },
              startupProbe: { httpGet: { path: "/start", port: 8080 } },
            },
          ]),
        ],
      },
    });

    const { checkProbesHealth } = await import("./check-probes-health");
    const report = await checkProbesHealth("cluster-1", { force: true, data: data as never });

    expect(report.status).toBe("ok");
    expect(report.items).toHaveLength(1);
    expect(report.workloads).toHaveLength(1);
    expect(report.workloads[0].status).toBe("ok");
  });

  it("reports critical when all probes are missing", async () => {
    const data = makeClusterData({
      deployments: {
        items: [makeDeployment("no-probes", "default", [{ name: "main" }])],
      },
    });

    const { checkProbesHealth } = await import("./check-probes-health");
    const report = await checkProbesHealth("cluster-2", { force: true, data: data as never });

    expect(report.status).toBe("critical");
    const item = report.items.find((i: { workload: string }) => i.workload === "no-probes");
    expect(item?.issues).toContain("Missing all probes");
    expect(item?.issues).toContain("Missing readinessProbe");
  });

  it("warns when readiness and liveness probes are identical", async () => {
    const probe = {
      httpGet: { path: "/health", port: 8080 },
      initialDelaySeconds: 10,
      timeoutSeconds: 5,
      periodSeconds: 10,
      failureThreshold: 3,
      successThreshold: 1,
    };
    const data = makeClusterData({
      deployments: {
        items: [
          makeDeployment("same-probes", "default", [
            {
              name: "main",
              readinessProbe: { ...probe },
              livenessProbe: { ...probe },
              startupProbe: { httpGet: { path: "/start", port: 8080 } },
            },
          ]),
        ],
      },
    });

    const { checkProbesHealth } = await import("./check-probes-health");
    const report = await checkProbesHealth("cluster-3", { force: true, data: data as never });

    const item = report.items[0];
    expect(item.issues).toContain("readinessProbe matches livenessProbe");
  });

  it("reports critical for aggressive liveness probe", async () => {
    const data = makeClusterData({
      deployments: {
        items: [
          makeDeployment("aggressive", "default", [
            {
              name: "main",
              readinessProbe: { httpGet: { path: "/ready", port: 8080 }, initialDelaySeconds: 10 },
              livenessProbe: {
                httpGet: { path: "/health", port: 8080 },
                timeoutSeconds: 1,
                failureThreshold: 1,
                initialDelaySeconds: 10,
              },
              startupProbe: { httpGet: { path: "/start", port: 8080 } },
            },
          ]),
        ],
      },
    });

    const { checkProbesHealth } = await import("./check-probes-health");
    const report = await checkProbesHealth("cluster-4", { force: true, data: data as never });

    expect(report.status).toBe("critical");
    const item = report.items[0];
    expect(item.issues).toContain("livenessProbe is too aggressive");
  });

  it("returns ok with empty workloads", async () => {
    const data = makeClusterData();

    const { checkProbesHealth } = await import("./check-probes-health");
    const report = await checkProbesHealth("cluster-5", { force: true, data: data as never });

    expect(report.status).toBe("ok");
    expect(report.items).toHaveLength(0);
    expect(report.workloads).toHaveLength(0);
  });

  it("handles loadClusterEntities error gracefully", async () => {
    loadClusterEntitiesMock.mockRejectedValueOnce(new Error("connection refused"));

    const { checkProbesHealth } = await import("./check-probes-health");
    const report = await checkProbesHealth("cluster-6", { force: true });

    expect(report.status).toBe("unreachable");
    expect(report.errors).toContain("connection refused");
    expect(report.items).toHaveLength(0);
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("handles data with non-ok status", async () => {
    loadClusterEntitiesMock.mockResolvedValueOnce({
      status: "error",
      errors: "forbidden",
    });

    const { checkProbesHealth } = await import("./check-probes-health");
    const report = await checkProbesHealth("cluster-7", { force: true });

    expect(report.status).toBe("insufficient");
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("warns when missing startupProbe with high initialDelay", async () => {
    const data = makeClusterData({
      deployments: {
        items: [
          makeDeployment("slow-start", "default", [
            {
              name: "main",
              readinessProbe: {
                httpGet: { path: "/ready", port: 8080 },
                initialDelaySeconds: 35,
                timeoutSeconds: 5,
                failureThreshold: 3,
              },
              livenessProbe: {
                httpGet: { path: "/health", port: 8080 },
                initialDelaySeconds: 35,
                timeoutSeconds: 5,
                failureThreshold: 3,
              },
            },
          ]),
        ],
      },
    });

    const { checkProbesHealth } = await import("./check-probes-health");
    const report = await checkProbesHealth("cluster-8", { force: true, data: data as never });

    const item = report.items[0];
    expect(item.issues).toContain("Missing startupProbe for slow start");
  });

  it("handles workload with empty containers array", async () => {
    const data = makeClusterData({
      deployments: {
        items: [makeDeployment("empty-containers", "default", [])],
      },
    });

    const { checkProbesHealth } = await import("./check-probes-health");
    const report = await checkProbesHealth("cluster-9", { force: true, data: data as never });

    expect(report.status).toBe("warning");
    const item = report.items[0];
    expect(item.issues).toContain("No containers defined");
  });

  it("uses cache within 60s", async () => {
    const data = makeClusterData();
    loadClusterEntitiesMock.mockResolvedValue(data);

    const { checkProbesHealth } = await import("./check-probes-health");
    await checkProbesHealth("cluster-10", { data: data as never });
    await checkProbesHealth("cluster-10");

    expect(loadClusterEntitiesMock).not.toHaveBeenCalled();
  });
});
