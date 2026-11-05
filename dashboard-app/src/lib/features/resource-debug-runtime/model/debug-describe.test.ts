import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDebugDescribeArgs,
  buildDebugDescribeCommand,
  buildDebugDescribeLabel,
  runDebugDescribe,
} from "./debug-describe";

const openDebugDescribeModal = vi.hoisted(() => vi.fn());

vi.mock("$features/shell", () => ({
  openDebugDescribeModal,
}));

describe("debug-describe runtime", () => {
  beforeEach(() => {
    openDebugDescribeModal.mockReset();
  });

  it("builds a namespaced kubectl describe command", () => {
    expect(
      buildDebugDescribeCommand({
        clusterId: "cluster-a",
        resource: "pod",
        name: "api-0",
        namespace: "prod",
      }),
    ).toBe("kubectl describe pod -n prod -- api-0");
  });

  it("omits the namespace flag for cluster-scoped resources", () => {
    expect(
      buildDebugDescribeArgs({ clusterId: "cluster-a", resource: "ClusterRoles", name: "admin" }),
    ).toEqual(["describe", "clusterroles", "--", "admin"]);
  });

  it("keeps an unusual name as one argument and quotes it on the command line", () => {
    const target = { clusterId: "cluster-a", resource: "roles", name: "a b", namespace: "team" };

    expect(buildDebugDescribeArgs(target)).toEqual([
      "describe",
      "roles",
      "-n",
      "team",
      "--",
      "a b",
    ]);
    expect(buildDebugDescribeCommand(target)).toBe("kubectl describe roles -n team -- 'a b'");
  });

  it("builds a readable debug describe label", () => {
    expect(
      buildDebugDescribeLabel({
        clusterId: "cluster-a",
        resource: "pod",
        name: "api-0",
        namespace: "prod",
      }),
    ).toBe("Describe pod prod/api-0");
  });

  it("opens a debug describe shell session with preset command", () => {
    runDebugDescribe({
      clusterId: "cluster-a",
      resource: "pod",
      name: "api-0",
      namespace: "prod",
    });

    expect(openDebugDescribeModal).toHaveBeenCalledWith("cluster-a", {
      preset: {
        tool: "kubectl",
        args: ["describe", "pod", "-n", "prod", "--", "api-0"],
        commandLine: "kubectl describe pod -n prod -- api-0",
      },
      sessionLabel: "Describe pod prod/api-0",
      targetNamespace: "prod",
    });
  });
});
