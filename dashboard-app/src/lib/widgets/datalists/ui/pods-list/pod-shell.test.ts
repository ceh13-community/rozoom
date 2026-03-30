import { describe, it, expect } from "vitest";
import {
  buildDebugClusterRoleBindingArgs,
  buildDebugClusterRoleBindingGetArgs,
  buildDebugPodCreateArgs,
  buildDebugPodDeleteArgs,
  buildDebugServiceAccountArgs,
  buildDebugServiceAccountGetArgs,
  buildDebugPodExecArgs,
  buildDebugPodGetArgs,
  buildDebugPodName,
  buildDebugPodWaitArgs,
  describePodStartupFailure,
  getPodSessionInitialCommand,
  getDebugCommandCandidates,
  getDebugPodImages,
  isDebugPodNotFoundError,
  isImagePullFailure,
  parsePodPhase,
} from "./pod-shell";

describe("pod-shell helpers", () => {
  it("provides preferred and fallback debug images", () => {
    const images = getDebugPodImages();
    expect(images.length).toBeGreaterThan(1);
    expect(images[0]).toBe("dtzar/helm-kubectl:3.14.4");
  });

  it("provides command candidates with compatibility fallbacks", () => {
    const checks = getDebugCommandCandidates();
    const kubectlCheck = checks.find((item) => item.label === "kubectl version");
    expect(kubectlCheck?.required).toBe(true);
    expect(kubectlCheck?.commands).not.toContain("kubectl version --client --short");
    expect(kubectlCheck?.commands).toContain("kubectl version --client=true");

    const toolsCheck = checks.find((item) => item.label === "debug tools");
    expect(toolsCheck?.required).toBe(false);
    expect(toolsCheck?.commands[0]).toContain("Missing tools:");
  });
  it("builds a deterministic debug pod name", () => {
    expect(buildDebugPodName("My_Cluster.01")).toBe("debug-pod-my-cluster-01");
  });

  it("limits debug pod name length", () => {
    const name = buildDebugPodName("a".repeat(100));
    expect(name.length).toBeLessThanOrEqual(44);
    expect(name).toMatch(/^debug-pod-a+$/);
  });

  it("builds create args with provided image", () => {
    expect(buildDebugPodCreateArgs("team-prod", "dtzar/helm-kubectl:3.14.4")).toEqual([
      "run",
      "debug-pod-team-prod",
      "--image",
      "dtzar/helm-kubectl:3.14.4",
      "--restart",
      "Never",
      "--namespace",
      "default",
      "--overrides",
      '{"spec":{"serviceAccountName":"cluster-debug-shell"}}',
      "--labels",
      "app.kubernetes.io/name=cluster-debug-shell,app.kubernetes.io/managed-by=rozoom",
      "--command",
      "--",
      "sleep",
      "86400",
    ]);
  });

  it("builds RBAC bootstrap args", () => {
    expect(buildDebugServiceAccountGetArgs()).toEqual([
      "get",
      "serviceaccount",
      "cluster-debug-shell",
      "--namespace",
      "default",
    ]);

    expect(buildDebugServiceAccountArgs()).toEqual([
      "create",
      "serviceaccount",
      "cluster-debug-shell",
      "--namespace",
      "default",
    ]);

    expect(buildDebugClusterRoleBindingGetArgs()).toEqual([
      "get",
      "clusterrolebinding",
      "cluster-debug-shell-admin",
    ]);

    expect(buildDebugClusterRoleBindingArgs()).toEqual([
      "create",
      "clusterrolebinding",
      "cluster-debug-shell-admin",
      "--clusterrole",
      "cluster-admin",
      "--serviceaccount",
      "default:cluster-debug-shell",
    ]);
  });

  it("builds delete/get/exec/wait args", () => {
    expect(buildDebugPodDeleteArgs("team-prod")).toContain("debug-pod-team-prod");
    expect(buildDebugPodGetArgs("team-prod")).toContain("json");
    expect(buildDebugPodWaitArgs("team-prod")).toEqual([
      "wait",
      "--for=condition=Ready",
      "pod",
      "debug-pod-team-prod",
      "--namespace",
      "default",
      "--timeout=180s",
    ]);
    expect(buildDebugPodExecArgs("team-prod", "kubectl version --client")).toEqual([
      "exec",
      "-i",
      "--namespace",
      "default",
      "debug-pod-team-prod",
      "--",
      "sh",
      "-lc",
      "kubectl version --client",
    ]);
  });

  it("uses shell-safe initial commands for pod sessions", () => {
    expect(getPodSessionInitialCommand("debug")).toBe("kubectl get pods -A");
    expect(getPodSessionInitialCommand("pod-exec")).toBe("pwd");
    expect(getPodSessionInitialCommand("pod-attach")).toBe("");
  });

  it("detects when the shared debug pod disappeared", () => {
    expect(
      isDebugPodNotFoundError(
        'Error from server (NotFound): pods "debug-pod-a61a24c2-74b2-4545-b222-7a73448ae3" not found',
      ),
    ).toBe(true);
    expect(isDebugPodNotFoundError('pods "nginx" not found')).toBe(false);
  });

  it("parses pod phase safely", () => {
    expect(parsePodPhase('{"status":{"phase":"Running"}}')).toBe("Running");
    expect(parsePodPhase("invalid")).toBeNull();
  });

  it("describes startup failures", () => {
    expect(
      describePodStartupFailure(
        '{"status":{"phase":"Pending","containerStatuses":[{"state":{"waiting":{"reason":"ImagePullBackOff","message":"Back-off pulling image"}}}]}}',
      ),
    ).toContain("ImagePullBackOff");

    expect(describePodStartupFailure('{"status":{"phase":"Pending"}}')).toContain("Pending");
  });

  it("detects image pull failures", () => {
    expect(
      isImagePullFailure(
        '{"status":{"containerStatuses":[{"state":{"waiting":{"reason":"ErrImagePull"}}}]}}',
      ),
    ).toBe(true);
    expect(isImagePullFailure('{"status":{"phase":"Running"}}')).toBe(false);
  });
});
