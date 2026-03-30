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
    pods: { items: [] },
    deployments: { items: [] },
    statefulsets: { items: [] },
    poddisruptionbudgets: { items: [] },
    ...overrides,
  };
}

function makeDeployment(
  name: string,
  namespace: string,
  replicas: number,
  matchLabels: Record<string, string>,
  labels?: Record<string, string>,
) {
  return {
    metadata: { name, namespace, labels },
    spec: {
      replicas,
      selector: { matchLabels },
    },
  };
}

function makeStatefulSet(
  name: string,
  namespace: string,
  replicas: number,
  matchLabels: Record<string, string>,
  labels?: Record<string, string>,
) {
  return {
    metadata: { name, namespace, labels },
    spec: {
      replicas,
      selector: { matchLabels },
    },
  };
}

function makePdb(
  name: string,
  namespace: string,
  matchLabels: Record<string, string>,
  opts: {
    minAvailable?: number | string;
    maxUnavailable?: number | string;
    disruptionsAllowed?: number;
  } = {},
) {
  return {
    metadata: { name, namespace },
    spec: {
      selector: { matchLabels },
      minAvailable: opts.minAvailable,
      maxUnavailable: opts.maxUnavailable,
    },
    status: { disruptionsAllowed: opts.disruptionsAllowed },
  };
}

function makePod(name: string, namespace: string, labels: Record<string, string>) {
  return {
    metadata: { name, namespace, labels },
  };
}

describe("check-pdb", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    loadClusterEntitiesMock.mockReset();
    logErrorMock.mockReset();
  });

  it("returns ok report when workloads have proper PDBs", async () => {
    const labels = { app: "web" };
    const data = makeClusterData({
      deployments: {
        items: [makeDeployment("web-deploy", "default", 3, labels)],
      },
      poddisruptionbudgets: {
        items: [makePdb("web-pdb", "default", labels, { minAvailable: 2 })],
      },
      pods: {
        items: [makePod("web-1", "default", labels), makePod("web-2", "default", labels)],
      },
    });

    const { checkPdbStatus } = await import("./check-pdb");
    const report = await checkPdbStatus("cluster-1", { force: true, data: data as never });

    expect(report.status).toBe("ok");
    expect(report.items).toHaveLength(1);
    expect(report.items[0].workload).toBe("web-deploy");
    expect(report.items[0].pdbName).toBe("web-pdb");
    expect(report.items[0].mode).toBe("minAvailable");
    expect(report.summary.ok).toBe(1);
  });

  it("reports critical when critical stateful workload has no PDB", async () => {
    const labels = { app: "db" };
    const data = makeClusterData({
      statefulsets: {
        items: [makeStatefulSet("db-sts", "default", 3, labels)],
      },
      poddisruptionbudgets: { items: [] },
      pods: { items: [] },
    });

    const { checkPdbStatus } = await import("./check-pdb");
    const report = await checkPdbStatus("cluster-2", { force: true, data: data as never });

    expect(report.status).toBe("critical");
    expect(report.items[0].issues).toContain("Missing PDB for a critical or stateful workload.");
  });

  it("returns ok with empty workloads and no PDBs", async () => {
    const data = makeClusterData();

    const { checkPdbStatus } = await import("./check-pdb");
    const report = await checkPdbStatus("cluster-3", { force: true, data: data as never });

    expect(report.status).toBe("ok");
    expect(report.items).toHaveLength(0);
    expect(report.summary.total).toBe(0);
  });

  it("handles loadClusterEntities error gracefully", async () => {
    loadClusterEntitiesMock.mockRejectedValueOnce(new Error("connection refused"));

    const { checkPdbStatus } = await import("./check-pdb");
    const report = await checkPdbStatus("cluster-4", { force: true });

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

    const { checkPdbStatus } = await import("./check-pdb");
    const report = await checkPdbStatus("cluster-5", { force: true });

    expect(report.status).toBe("insufficient");
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("warns about single-replica workload with PDB", async () => {
    const labels = { app: "solo" };
    const data = makeClusterData({
      deployments: {
        items: [makeDeployment("solo-deploy", "default", 1, labels)],
      },
      poddisruptionbudgets: {
        items: [makePdb("solo-pdb", "default", labels, { maxUnavailable: 1 })],
      },
      pods: { items: [makePod("solo-1", "default", labels)] },
    });

    const { checkPdbStatus } = await import("./check-pdb");
    const report = await checkPdbStatus("cluster-6", { force: true, data: data as never });

    expect(report.items[0].issues).toContain(
      "PDB configured for a single-replica workload; drains may be blocked.",
    );
    expect(report.items[0].status).toBe("critical");
  });

  it("detects unmatched PDBs", async () => {
    const data = makeClusterData({
      deployments: {
        items: [makeDeployment("app-deploy", "default", 2, { app: "web" })],
      },
      poddisruptionbudgets: {
        items: [makePdb("orphan-pdb", "default", { app: "ghost" }, { minAvailable: 1 })],
      },
      pods: { items: [] },
    });

    const { checkPdbStatus } = await import("./check-pdb");
    const report = await checkPdbStatus("cluster-7", { force: true, data: data as never });

    const unmatchedItem = report.items.find(
      (i: { workloadType: string }) => i.workloadType === "PDB",
    );
    expect(unmatchedItem).toBeDefined();
    expect(unmatchedItem?.issues).toContain("PDB selector does not match any workload selector.");
  });

  it("uses cache within 60s", async () => {
    const data = makeClusterData();
    loadClusterEntitiesMock.mockResolvedValue(data);

    const { checkPdbStatus } = await import("./check-pdb");
    await checkPdbStatus("cluster-8", { data: data as never });
    await checkPdbStatus("cluster-8");

    // Second call should use cache, so loadClusterEntities is not called
    expect(loadClusterEntitiesMock).not.toHaveBeenCalled();
  });
});
