import { describe, expect, it, vi } from "vitest";
import { buildAllCommands, buildAppCommands, buildWorkloadCommands } from "./commands";

vi.mock("$app/navigation", () => ({ goto: vi.fn() }));
vi.mock("$features/cluster-manager", () => ({
  clustersList: {
    subscribe: (fn: (value: unknown[]) => void) => {
      fn([
        { uuid: "c1", name: "prod-east" },
        { uuid: "c2", name: "staging" },
      ]);
      return () => {};
    },
  },
}));

describe("buildAppCommands", () => {
  it("returns dashboard and cluster manager commands", () => {
    const cmds = buildAppCommands();
    expect(cmds.some((c) => c.id === "app:dashboard")).toBe(true);
    expect(cmds.some((c) => c.id === "app:cluster-manager")).toBe(true);
  });
});

describe("buildWorkloadCommands", () => {
  it("includes pods, deployments, and other workload pages", () => {
    const cmds = buildWorkloadCommands("test-cluster");
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain("nav:pods");
    expect(ids).toContain("nav:deployments");
    expect(ids).toContain("nav:configmaps");
  });

  it("assigns group from workload config", () => {
    const cmds = buildWorkloadCommands("test-cluster");
    const pods = cmds.find((c) => c.id === "nav:pods");
    expect(pods?.group).toBe("Workloads");
  });
});

describe("buildAllCommands", () => {
  it("includes cluster commands from store", () => {
    const cmds = buildAllCommands(null);
    expect(cmds.some((c) => c.label === "prod-east")).toBe(true);
    expect(cmds.some((c) => c.label === "staging")).toBe(true);
  });

  it("includes workload commands when clusterId is provided", () => {
    const cmds = buildAllCommands("c1");
    expect(cmds.some((c) => c.id === "nav:pods")).toBe(true);
  });

  it("excludes workload commands when clusterId is null", () => {
    const cmds = buildAllCommands(null);
    expect(cmds.some((c) => c.id === "nav:pods")).toBe(false);
  });
});
