import { describe, expect, it } from "vitest";
import { isMutatingKubectlCommand } from "./kubectl-mutation";

describe("isMutatingKubectlCommand", () => {
  it.each([
    [["delete", "deployment", "api", "--namespace", "default"]],
    [["scale", "deployment", "api", "--replicas=3", "-n", "prod"]],
    [["apply", "-f", "-"]],
    [["patch", "configmap", "settings", "--patch", "{}"]],
    [["rollout", "restart", "deployment/api"]],
    [["rollout", "undo", "deployment/api"]],
    [["cordon", "node-1"]],
    [["create", "-f", "manifest.yaml"]],
  ])("treats %j as a mutation", (args) => {
    expect(isMutatingKubectlCommand(args)).toBe(true);
  });

  it.each([
    [["get", "pods", "-o", "json"]],
    [["describe", "deployment", "api"]],
    [["logs", "api-7d9f", "--tail", "100"]],
    [["top", "pods"]],
    [["version", "-o", "json"]],
    [["rollout", "status", "deployment/api"]],
    [["rollout", "history", "deployment/api"]],
    [["exec", "api-7d9f", "--", "sh"]],
    [["get", "--raw", "/version"]],
    [[]],
  ])("treats %j as a read", (args) => {
    expect(isMutatingKubectlCommand(args)).toBe(false);
  });

  it("is case-insensitive on the verb", () => {
    expect(isMutatingKubectlCommand(["Delete", "pod", "api"])).toBe(true);
    expect(isMutatingKubectlCommand(["ROLLOUT", "Restart", "deployment/api"])).toBe(true);
  });
});
