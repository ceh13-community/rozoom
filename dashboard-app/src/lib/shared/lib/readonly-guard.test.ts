import { beforeEach, describe, expect, it } from "vitest";
import {
  buildReadOnlyBlockedResult,
  checkHelmActionReadOnly,
  checkKubectlReadOnly,
  classifyKubectlAction,
  getClusterSafetyInfo,
  registerClusterSafetyInfo,
  resetClusterSafetyRegistryForTests,
} from "./readonly-guard";

const LOCKED = { uuid: "uuid-locked", name: "prod locked", readOnly: true, env: "prod" };
const OPEN = { uuid: "uuid-open", name: "dev-open", readOnly: false, env: "dev" };

describe("readonly-guard", () => {
  beforeEach(() => {
    resetClusterSafetyRegistryForTests();
    registerClusterSafetyInfo([LOCKED, OPEN]);
  });

  describe("registry", () => {
    it("resolves clusters by uuid and by name, including sanitized keys", () => {
      expect(getClusterSafetyInfo("uuid-locked")?.readOnly).toBe(true);
      // Route slugs arrive pre-sanitized the same way kubeconfig files are keyed.
      expect(getClusterSafetyInfo("prod locked")?.readOnly).toBe(true);
      expect(getClusterSafetyInfo("prod_locked")?.readOnly).toBe(true);
      expect(getClusterSafetyInfo("dev-open")?.readOnly).toBe(false);
    });

    it("returns undefined for unknown or missing cluster ids", () => {
      expect(getClusterSafetyInfo("nope")).toBeUndefined();
      expect(getClusterSafetyInfo(null)).toBeUndefined();
      expect(getClusterSafetyInfo(undefined)).toBeUndefined();
    });

    it("drops stale entries on re-register", () => {
      registerClusterSafetyInfo([OPEN]);
      expect(getClusterSafetyInfo("uuid-locked")).toBeUndefined();
    });
  });

  describe("classifyKubectlAction", () => {
    it("maps pod deletes separately from resource deletes", () => {
      expect(classifyKubectlAction(["delete", "pod", "x"])).toBe("delete-pod");
      expect(classifyKubectlAction(["delete", "pods", "x", "y"])).toBe("delete-pod");
      expect(classifyKubectlAction(["delete", "pod/x"])).toBe("delete-pod");
      expect(classifyKubectlAction(["delete", "deployment", "x"])).toBe("delete-resource");
      expect(classifyKubectlAction(["delete", "crd", "x"])).toBe("delete-resource");
    });

    it("maps rollout subcommands", () => {
      expect(classifyKubectlAction(["rollout", "restart", "deployment/x"])).toBe(
        "restart-workload",
      );
      expect(classifyKubectlAction(["rollout", "undo", "deployment/x"])).toBe("rollback-workload");
      expect(classifyKubectlAction(["rollout", "status", "deployment/x"])).toBeNull();
      expect(classifyKubectlAction(["rollout", "history", "deployment/x"])).toBeNull();
    });

    it("maps mutating verbs and shell access", () => {
      expect(classifyKubectlAction(["scale", "deployment/x", "--replicas=3"])).toBe(
        "scale-workload",
      );
      expect(classifyKubectlAction(["apply", "-f", "x.yaml"])).toBe("apply-yaml");
      expect(classifyKubectlAction(["patch", "ns", "x", "-p", "{}"])).toBe("edit-resource");
      expect(classifyKubectlAction(["cordon", "node-1"])).toBe("edit-resource");
      expect(classifyKubectlAction(["drain", "node-1"])).toBe("edit-resource");
      expect(classifyKubectlAction(["exec", "-it", "pod/x", "--", "sh"])).toBe("exec-shell");
      expect(classifyKubectlAction(["evict", "x", "--namespace", "default"])).toBe("delete-pod");
    });

    it("treats reads as safe", () => {
      for (const args of [
        ["get", "pods"],
        ["describe", "pod", "x"],
        ["logs", "pod/x"],
        ["top", "nodes"],
        ["version"],
        [],
      ]) {
        expect(classifyKubectlAction(args)).toBeNull();
      }
    });
  });

  describe("checkKubectlReadOnly", () => {
    it("blocks mutations on a read-only cluster", () => {
      const result = checkKubectlReadOnly("uuid-locked", ["delete", "pod", "x"]);
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("read-only");
    });

    it("allows reads on a read-only cluster", () => {
      expect(checkKubectlReadOnly("uuid-locked", ["get", "pods"]).blocked).toBe(false);
    });

    it("allows mutations on a writable cluster", () => {
      expect(checkKubectlReadOnly("uuid-open", ["delete", "pod", "x"]).blocked).toBe(false);
    });

    it("does not block unknown clusters (no registry entry)", () => {
      expect(checkKubectlReadOnly("unknown", ["delete", "pod", "x"]).blocked).toBe(false);
      expect(checkKubectlReadOnly(undefined, ["delete", "pod", "x"]).blocked).toBe(false);
    });
  });

  describe("checkHelmActionReadOnly", () => {
    it("blocks uninstall and rollback on a read-only cluster", () => {
      expect(checkHelmActionReadOnly("uuid-locked", "helm-uninstall").blocked).toBe(true);
      expect(checkHelmActionReadOnly("uuid-locked", "helm-rollback").blocked).toBe(true);
    });

    it("leaves install to the UI confirmation flow", () => {
      expect(checkHelmActionReadOnly("uuid-locked", "helm-install").blocked).toBe(false);
    });

    it("allows everything on a writable cluster", () => {
      expect(checkHelmActionReadOnly("uuid-open", "helm-uninstall").blocked).toBe(false);
    });
  });

  describe("buildReadOnlyBlockedResult", () => {
    it("produces a non-zero exit with the reason in errors", () => {
      const result = buildReadOnlyBlockedResult('Cluster "x" is read-only.');
      expect(result.code).toBe(1);
      expect(result.output).toBe("");
      expect(result.errors).toContain("[BLOCKED]");
      expect(result.errors).toContain('Cluster "x" is read-only.');
    });
  });
});
