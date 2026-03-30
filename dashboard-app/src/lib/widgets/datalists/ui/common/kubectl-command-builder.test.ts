import { describe, expect, it } from "vitest";
import {
  buildKubectlDescribeCommand,
  buildKubectlGetYamlCommand,
  buildKubectlLogsArgs,
} from "./kubectl-command-builder";

describe("kubectl-command-builder", () => {
  it("builds get yaml and describe commands for namespaced resources", () => {
    expect(
      buildKubectlGetYamlCommand({
        resource: "configmaps",
        name: "app-config",
        namespace: "prod",
      }),
    ).toBe("kubectl get configmaps app-config -n prod -o yaml");

    expect(
      buildKubectlDescribeCommand({
        resource: "pods",
        name: "api-123",
        namespace: "prod",
      }),
    ).toBe("kubectl describe pods api-123 -n prod");
  });

  it("omits namespace flag for cluster scoped resources", () => {
    expect(
      buildKubectlGetYamlCommand({
        resource: "priorityclasses",
        name: "system-cluster-critical",
        namespaceScoped: false,
      }),
    ).toBe("kubectl get priorityclasses system-cluster-critical -o yaml");
  });

  it("defaults namespace to 'default' when omitted or empty", () => {
    expect(buildKubectlGetYamlCommand({ resource: "pods", name: "x" })).toBe(
      "kubectl get pods x -n default -o yaml",
    );

    expect(buildKubectlGetYamlCommand({ resource: "pods", name: "x", namespace: "" })).toBe(
      "kubectl get pods x -n default -o yaml",
    );

    expect(buildKubectlGetYamlCommand({ resource: "pods", name: "x", namespace: "  " })).toBe(
      "kubectl get pods x -n default -o yaml",
    );

    expect(buildKubectlDescribeCommand({ resource: "pods", name: "x" })).toBe(
      "kubectl describe pods x -n default",
    );
  });

  it("uses --all-containers when container is __all__", () => {
    const args = buildKubectlLogsArgs({ target: "pod/x", container: "__all__" });
    expect(args).toContain("--all-containers=true");
    expect(args).not.toContain("--container");
  });

  it("uses --previous (not --previous=true) when allPods is false", () => {
    const args = buildKubectlLogsArgs({ target: "pod/x", previous: true });
    expect(args).toContain("--previous");
    expect(args).not.toContain("--previous=true");
  });

  it("builds logs args with consistent defaults and flags", () => {
    expect(
      buildKubectlLogsArgs({
        target: "api-123",
        namespace: "prod",
      }),
    ).toEqual([
      "logs",
      "api-123",
      "--namespace",
      "prod",
      "--tail=400",
      "--timestamps=true",
      "--all-containers=true",
    ]);

    expect(
      buildKubectlLogsArgs({
        target: "deployment/api",
        namespace: "prod",
        allPods: true,
        container: "main",
        previous: true,
        follow: true,
      }),
    ).toEqual([
      "logs",
      "deployment/api",
      "--namespace",
      "prod",
      "--tail=400",
      "--timestamps=true",
      "--all-pods=true",
      "--container",
      "main",
      "--previous=true",
      "-f",
    ]);
  });
});
