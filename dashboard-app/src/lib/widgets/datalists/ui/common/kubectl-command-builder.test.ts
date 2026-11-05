import { describe, expect, it } from "vitest";
import {
  buildKubectlDescribeCommand,
  buildKubectlGetYamlCommand,
  buildKubectlLogsArgs,
  canCopyKubectlCommand,
} from "./kubectl-command-builder";

describe("kubectl-command-builder", () => {
  it("quotes a name that a shell would not read back as one word", () => {
    const target = { resource: "roles", name: "a b;c", namespace: "team" };

    expect(buildKubectlDescribeCommand(target)).toBe("kubectl describe roles -n team -- 'a b;c'");
    expect(buildKubectlGetYamlCommand({ ...target, namespaceScoped: false })).toBe(
      "kubectl get roles -o yaml -- 'a b;c'",
    );
  });

  it("keeps a name with a leading dash from being read as a flag", () => {
    expect(
      buildKubectlDescribeCommand({ resource: "roles", name: "--all", namespace: "team" }),
    ).toBe("kubectl describe roles -n team -- --all");
  });

  it("allows copying an unusual name on POSIX only", () => {
    const usual = { resource: "roles", name: "viewer", namespace: "team" };
    const unusual = { resource: "roles", name: "a&calc", namespace: "team" };

    expect(canCopyKubectlCommand(usual, true)).toBe(true);
    expect(canCopyKubectlCommand(unusual, true)).toBe(false);
    expect(canCopyKubectlCommand(unusual, false)).toBe(true);
  });

  it("builds get yaml and describe commands for namespaced resources", () => {
    expect(
      buildKubectlGetYamlCommand({
        resource: "configmaps",
        name: "app-config",
        namespace: "prod",
      }),
    ).toBe("kubectl get configmaps -n prod -o yaml -- app-config");

    expect(
      buildKubectlDescribeCommand({
        resource: "pods",
        name: "api-123",
        namespace: "prod",
      }),
    ).toBe("kubectl describe pods -n prod -- api-123");
  });

  it("omits namespace flag for cluster scoped resources", () => {
    expect(
      buildKubectlGetYamlCommand({
        resource: "priorityclasses",
        name: "system-cluster-critical",
        namespaceScoped: false,
      }),
    ).toBe("kubectl get priorityclasses -o yaml -- system-cluster-critical");
  });

  it("defaults namespace to 'default' when omitted or empty", () => {
    expect(buildKubectlGetYamlCommand({ resource: "pods", name: "x" })).toBe(
      "kubectl get pods -n default -o yaml -- x",
    );

    expect(buildKubectlGetYamlCommand({ resource: "pods", name: "x", namespace: "" })).toBe(
      "kubectl get pods -n default -o yaml -- x",
    );

    expect(buildKubectlGetYamlCommand({ resource: "pods", name: "x", namespace: "  " })).toBe(
      "kubectl get pods -n default -o yaml -- x",
    );

    expect(buildKubectlDescribeCommand({ resource: "pods", name: "x" })).toBe(
      "kubectl describe pods -n default -- x",
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
