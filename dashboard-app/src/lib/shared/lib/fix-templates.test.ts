import { describe, expect, it } from "vitest";
import {
  generateFix,
  getFixTemplate,
  getFixTemplates,
  getTemplatesByCategory,
} from "./fix-templates";

describe("fix-templates", () => {
  it("returns all templates", () => {
    const templates = getFixTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(7);
  });

  it("finds template by id", () => {
    const pdb = getFixTemplate("pdb");
    expect(pdb).toBeDefined();
    expect(pdb?.title).toBe("PodDisruptionBudget");
  });

  it("returns undefined for unknown id", () => {
    expect(getFixTemplate("unknown" as never)).toBeUndefined();
  });

  describe("generateFix", () => {
    it("generates PDB yaml", () => {
      const yaml = generateFix("pdb", {
        namespace: "production",
        name: "web-api",
        labels: { app: "web-api" },
      });
      expect(yaml).toContain("kind: PodDisruptionBudget");
      expect(yaml).toContain("namespace: production");
      expect(yaml).toContain("name: web-api-pdb");
      expect(yaml).toContain('app: "web-api"');
      expect(yaml).toContain("minAvailable: 1");
    });

    it("generates default-deny NetworkPolicy", () => {
      const yaml = generateFix("network-policy-default-deny", { namespace: "default" });
      expect(yaml).toContain("kind: NetworkPolicy");
      expect(yaml).toContain("name: default-deny-all");
      expect(yaml).toContain("podSelector: {}");
      expect(yaml).toContain("port: 53");
    });

    it("generates ResourceQuota with custom limits", () => {
      const yaml = generateFix("resource-quota", {
        namespace: "staging",
        cpuRequest: "2",
        memoryRequest: "4Gi",
        cpuLimit: "4",
        memoryLimit: "8Gi",
      });
      expect(yaml).toContain("kind: ResourceQuota");
      expect(yaml).toContain('requests.cpu: "2"');
      expect(yaml).toContain('limits.memory: "8Gi"');
      expect(yaml).toContain('pods: "50"');
    });

    it("generates LimitRange with defaults", () => {
      const yaml = generateFix("limit-range", { namespace: "dev" });
      expect(yaml).toContain("kind: LimitRange");
      expect(yaml).toContain('cpu: "500m"');
      expect(yaml).toContain('memory: "128Mi"');
    });

    it("generates readiness probe", () => {
      const yaml = generateFix("readiness-probe", { namespace: "default", port: 3000 });
      expect(yaml).toContain("readinessProbe:");
      expect(yaml).toContain("port: 3000");
      expect(yaml).toContain("path: /healthz");
    });

    it("generates liveness probe", () => {
      const yaml = generateFix("liveness-probe", { namespace: "default" });
      expect(yaml).toContain("livenessProbe:");
      expect(yaml).toContain("port: 8080");
      expect(yaml).toContain("initialDelaySeconds: 15");
    });

    it("generates security context", () => {
      const yaml = generateFix("security-context", { namespace: "default" });
      expect(yaml).toContain("runAsNonRoot: true");
      expect(yaml).toContain("readOnlyRootFilesystem: true");
      expect(yaml).toContain("allowPrivilegeEscalation: false");
      expect(yaml).toContain("- ALL");
    });

    it("returns null for unknown template", () => {
      expect(generateFix("unknown" as never, { namespace: "default" })).toBeNull();
    });
  });

  describe("getTemplatesByCategory", () => {
    it("groups templates by category", () => {
      const byCategory = getTemplatesByCategory();
      expect(byCategory["Security"]).toBeDefined();
      expect(byCategory["Security"]!.length).toBeGreaterThanOrEqual(2);
      expect(byCategory["High Availability"]).toBeDefined();
      expect(byCategory["Capacity"]).toBeDefined();
      expect(byCategory["Health Checks"]).toBeDefined();
    });
  });
});
