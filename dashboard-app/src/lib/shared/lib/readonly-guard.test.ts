import { beforeEach, describe, expect, it } from "vitest";
import {
  buildReadOnlyBlockedResult,
  checkCliReadOnly,
  checkHelmActionReadOnly,
  checkKubectlReadOnly,
  classifyHelmAction,
  classifyKubectlAction,
  classifyVeleroAction,
  clusterIdFromKubeconfigArg,
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

    it("blocks install on a read-only cluster too (no confirmation flow since 0.26.2)", () => {
      const result = checkHelmActionReadOnly("uuid-locked", "helm-install");
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("read-only");
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

// Reviewer verdict GKFjp7g8, finding 5: on a read-only cluster `certificate approve`,
// `helm install` from the GitOps panel, `velero create` and `kubectl delete` typed into
// the debug terminal all went through. These pin the boundary that now refuses them.
describe("readonly boundary for CLIs", () => {
  beforeEach(() => {
    resetClusterSafetyRegistryForTests();
    registerClusterSafetyInfo([LOCKED, OPEN]);
  });

  describe("classifyKubectlAction, terminal shapes", () => {
    it("treats certificate approve and deny as writes", () => {
      expect(classifyKubectlAction(["certificate", "approve", "--", "csr-1"])).toBe(
        "edit-resource",
      );
      expect(classifyKubectlAction(["certificate", "deny", "csr-1"])).toBe("edit-resource");
    });

    it("finds the verb behind leading global flags", () => {
      expect(classifyKubectlAction(["-n", "prod", "delete", "pod", "x"])).toBe("delete-pod");
      expect(classifyKubectlAction(["--namespace=prod", "scale", "deploy/x", "--replicas=0"])).toBe(
        "scale-workload",
      );
      expect(classifyKubectlAction(["--context", "c1", "-v", "6", "apply", "-f", "x.yaml"])).toBe(
        "apply-yaml",
      );
      expect(classifyKubectlAction(["-n", "prod", "get", "pods"])).toBeNull();
    });

    it("treats auth reconcile and oc adm mutations as writes, oc adm reads as reads", () => {
      expect(classifyKubectlAction(["auth", "reconcile", "-f", "rbac.yaml"])).toBe("apply-yaml");
      expect(classifyKubectlAction(["auth", "can-i", "delete", "pods"])).toBeNull();
      expect(classifyKubectlAction(["adm", "certificate", "approve", "csr-1"])).toBe(
        "edit-resource",
      );
      expect(classifyKubectlAction(["adm", "drain", "node-1"])).toBe("edit-resource");
      expect(classifyKubectlAction(["adm", "top", "nodes"])).toBeNull();
      expect(classifyKubectlAction(["adm", "inspect", "ns/openshift-etcd"])).toBeNull();
    });
  });

  describe("classifyHelmAction", () => {
    it("maps install, upgrade, uninstall and rollback", () => {
      expect(classifyHelmAction(["install", "rel", "chart"])).toBe("helm-install");
      expect(classifyHelmAction(["upgrade", "--install", "rel", "chart"])).toBe("helm-install");
      expect(classifyHelmAction(["-n", "velero", "uninstall", "rel"])).toBe("helm-uninstall");
      expect(classifyHelmAction(["delete", "rel"])).toBe("helm-uninstall");
      expect(classifyHelmAction(["rollback", "rel", "2"])).toBe("helm-rollback");
    });

    it("leaves reads alone", () => {
      for (const args of [
        ["list", "-A"],
        ["status", "rel"],
        ["history", "rel"],
        ["repo", "add", "x", "https://example.invalid"],
        ["template", "rel", "chart"],
        ["get", "values", "rel"],
        [],
      ]) {
        expect(classifyHelmAction(args)).toBeNull();
      }
    });
  });

  describe("classifyVeleroAction", () => {
    it("maps create, delete, install and uninstall", () => {
      expect(classifyVeleroAction(["backup", "create", "b1", "--ttl", "24h0m0s"])).toBe(
        "apply-yaml",
      );
      expect(classifyVeleroAction(["restore", "create", "--from-backup", "b1"])).toBe("apply-yaml");
      expect(classifyVeleroAction(["schedule", "delete", "s1"])).toBe("delete-resource");
      expect(classifyVeleroAction(["install", "--provider", "aws"])).toBe("apply-yaml");
      expect(classifyVeleroAction(["uninstall"])).toBe("delete-resource");
    });

    it("leaves reads alone", () => {
      for (const args of [
        ["backup", "get"],
        ["backup", "describe", "b1"],
        ["backup", "logs", "b1"],
        ["version"],
        ["backup-location", "get"],
      ]) {
        expect(classifyVeleroAction(args)).toBeNull();
      }
    });
  });

  describe("checkCliReadOnly", () => {
    it("blocks the four reviewer scenarios on a read-only cluster", () => {
      expect(
        checkCliReadOnly("uuid-locked", "kubectl", ["certificate", "approve", "--", "csr-1"])
          .blocked,
      ).toBe(true);
      expect(
        checkCliReadOnly("uuid-locked", "helm", ["install", "argocd", "argo/argo-cd"]).blocked,
      ).toBe(true);
      expect(checkCliReadOnly("uuid-locked", "velero", ["backup", "create", "b1"]).blocked).toBe(
        true,
      );
      expect(checkCliReadOnly("uuid-locked", "kubectl", ["delete", "pod", "x"]).blocked).toBe(true);
    });

    it("blocks oc writes and allows oc reads", () => {
      expect(checkCliReadOnly("uuid-locked", "oc", ["adm", "drain", "node-1"]).blocked).toBe(true);
      expect(checkCliReadOnly("uuid-locked", "oc", ["get", "pods"]).blocked).toBe(false);
    });

    it("allows reads and non-cluster tools on a read-only cluster", () => {
      expect(checkCliReadOnly("uuid-locked", "kubectl", ["get", "pods", "-A"]).blocked).toBe(false);
      expect(checkCliReadOnly("uuid-locked", "helm", ["list", "-A"]).blocked).toBe(false);
      expect(checkCliReadOnly("uuid-locked", "velero", ["backup", "get"]).blocked).toBe(false);
      expect(
        checkCliReadOnly("uuid-locked", "curl", ["-sI", "https://example.invalid"]).blocked,
      ).toBe(false);
      expect(checkCliReadOnly("uuid-locked", "trivy", ["k8s", "--report", "summary"]).blocked).toBe(
        false,
      );
    });

    it("allows everything on a writable or unknown cluster", () => {
      expect(checkCliReadOnly("uuid-open", "helm", ["install", "x", "y"]).blocked).toBe(false);
      expect(checkCliReadOnly("nope", "kubectl", ["delete", "pod", "x"]).blocked).toBe(false);
      expect(checkCliReadOnly(undefined, "velero", ["install"]).blocked).toBe(false);
    });

    it("carries the cluster name in the reason", () => {
      expect(checkCliReadOnly("uuid-locked", "helm", ["install", "x", "y"]).reason).toContain(
        "prod locked",
      );
    });
  });

  describe("clusterIdFromKubeconfigArg", () => {
    it("recovers the registry key from the kubeconfig file name", () => {
      expect(
        clusterIdFromKubeconfigArg([
          "install",
          "x",
          "y",
          "--kubeconfig",
          "/home/u/.local/share/app/configs/uuid-locked.yaml",
        ]),
      ).toBe("uuid-locked");
      expect(
        clusterIdFromKubeconfigArg(["--kubeconfig=C:\\Users\\u\\configs\\uuid-open.yaml", "list"]),
      ).toBe("uuid-open");
      expect(clusterIdFromKubeconfigArg(["list", "-A"])).toBeUndefined();
    });

    it("lets execCli-style callers be checked through the file name", () => {
      const args = ["backup", "create", "b1", "--kubeconfig", "/x/configs/uuid-locked.yaml"];
      expect(checkCliReadOnly(clusterIdFromKubeconfigArg(args), "velero", args).blocked).toBe(true);
    });
  });
});
