import { describe, expect, it } from "vitest";
import {
  getBootstrapSteps,
  generateArgoCDAppYaml,
  generateFluxGitRepositoryYaml,
  generateFluxKustomizationYaml,
} from "./gitops-bootstrap";

describe("gitops-bootstrap", () => {
  const argoConfig = {
    provider: "argocd" as const,
    repoUrl: "https://github.com/org/infra.git",
    branch: "main",
    path: "k8s/overlays/prod",
  };

  const fluxConfig = {
    provider: "flux" as const,
    repoUrl: "https://github.com/org/infra.git",
    branch: "main",
    path: "clusters/prod",
  };

  describe("getBootstrapSteps", () => {
    it("returns 2 steps for ArgoCD", () => {
      const steps = getBootstrapSteps(argoConfig);
      expect(steps).toHaveLength(2);
      expect(steps[0]?.id).toBe("argocd-install");
      expect(steps[1]?.id).toBe("argocd-app");
    });

    it("returns 3 steps for Flux", () => {
      const steps = getBootstrapSteps(fluxConfig);
      expect(steps).toHaveLength(3);
      expect(steps[0]?.id).toBe("flux-install");
      expect(steps[1]?.id).toBe("flux-source");
      expect(steps[2]?.id).toBe("flux-kustomization");
    });

    it("uses default branch and path", () => {
      const steps = getBootstrapSteps({ provider: "argocd", repoUrl: "https://example.com/repo" });
      expect(steps).toHaveLength(2);
    });
  });

  describe("generateArgoCDAppYaml", () => {
    it("generates valid ArgoCD Application", () => {
      const yaml = generateArgoCDAppYaml(argoConfig);
      expect(yaml).toContain("kind: Application");
      expect(yaml).toContain("namespace: argocd");
      expect(yaml).toContain("repoURL: https://github.com/org/infra.git");
      expect(yaml).toContain("targetRevision: main");
      expect(yaml).toContain("path: k8s/overlays/prod");
      expect(yaml).toContain("selfHeal: true");
    });

    it("uses custom namespace", () => {
      const yaml = generateArgoCDAppYaml({ ...argoConfig, namespace: "gitops" });
      expect(yaml).toContain("namespace: gitops");
    });
  });

  describe("generateFluxGitRepositoryYaml", () => {
    it("generates valid GitRepository", () => {
      const yaml = generateFluxGitRepositoryYaml(fluxConfig);
      expect(yaml).toContain("kind: GitRepository");
      expect(yaml).toContain("namespace: flux-system");
      expect(yaml).toContain("url: https://github.com/org/infra.git");
      expect(yaml).toContain("branch: main");
    });
  });

  describe("generateFluxKustomizationYaml", () => {
    it("generates valid Kustomization", () => {
      const yaml = generateFluxKustomizationYaml(fluxConfig);
      expect(yaml).toContain("kind: Kustomization");
      expect(yaml).toContain("path: clusters/prod");
      expect(yaml).toContain("prune: true");
      expect(yaml).toContain("sourceRef:");
      expect(yaml).toContain("kind: GitRepository");
    });
  });
});
