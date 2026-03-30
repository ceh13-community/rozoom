import { describe, expect, it } from "vitest";
import {
  checkActionSafety,
  isProdEnvironment,
  inferRiskLevel,
  type DestructiveAction,
} from "./cluster-safety";

describe("cluster-safety", () => {
  describe("checkActionSafety", () => {
    const readOnlyCluster = { name: "prod-locked", readOnly: true, env: "prod" };
    const prodCluster = { name: "prod-open", readOnly: false, env: "prod" };
    const devCluster = { name: "dev", readOnly: false, env: "dev" };

    it("blocks destructive actions on read-only clusters", () => {
      const blocked: DestructiveAction[] = [
        "delete-pod",
        "delete-resource",
        "scale-workload",
        "restart-workload",
        "rollback-workload",
        "apply-yaml",
        "helm-uninstall",
        "helm-rollback",
      ];

      for (const action of blocked) {
        const result = checkActionSafety(readOnlyCluster, action);
        expect(result.allowed, `${action} should be blocked`).toBe(false);
        expect(result.reason).toContain("read-only");
      }
    });

    it("requires confirmation for cautious actions on read-only clusters", () => {
      const cautious: DestructiveAction[] = ["helm-install", "exec-shell", "edit-resource"];

      for (const action of cautious) {
        const result = checkActionSafety(readOnlyCluster, action);
        expect(result.allowed, `${action} should be allowed`).toBe(true);
        expect(result.requiresConfirmation, `${action} should require confirmation`).toBe(true);
      }
    });

    it("requires confirmation for destructive actions on prod clusters", () => {
      const result = checkActionSafety(prodCluster, "delete-pod");
      expect(result.allowed).toBe(true);
      expect(result.requiresConfirmation).toBe(true);
      expect(result.reason).toContain("production");
    });

    it("allows all actions on dev clusters without confirmation", () => {
      const actions: DestructiveAction[] = [
        "delete-pod",
        "scale-workload",
        "helm-install",
        "exec-shell",
      ];

      for (const action of actions) {
        const result = checkActionSafety(devCluster, action);
        expect(result.allowed, `${action} should be allowed`).toBe(true);
        expect(result.requiresConfirmation, `${action} should not need confirmation`).toBe(false);
      }
    });
  });

  describe("isProdEnvironment", () => {
    it("detects prod and production", () => {
      expect(isProdEnvironment("prod")).toBe(true);
      expect(isProdEnvironment("production")).toBe(true);
      expect(isProdEnvironment("PROD")).toBe(true);
      expect(isProdEnvironment("Production")).toBe(true);
    });

    it("returns false for non-prod", () => {
      expect(isProdEnvironment("dev")).toBe(false);
      expect(isProdEnvironment("stage")).toBe(false);
      expect(isProdEnvironment(undefined)).toBe(false);
    });
  });

  describe("inferRiskLevel", () => {
    it("returns locked for read-only", () => {
      expect(inferRiskLevel({ readOnly: true, env: "dev" })).toBe("locked");
    });

    it("returns caution for prod", () => {
      expect(inferRiskLevel({ readOnly: false, env: "prod" })).toBe("caution");
    });

    it("returns safe for dev", () => {
      expect(inferRiskLevel({ readOnly: false, env: "dev" })).toBe("safe");
    });
  });
});
