import { beforeEach, describe, expect, it, vi } from "vitest";
import {
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
    ).toBe("kubectl describe pod api-0 -n prod");
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
      initialCommand: "kubectl describe pod api-0 -n prod",
      sessionLabel: "Describe pod prod/api-0",
      targetNamespace: "prod",
    });
  });
});
