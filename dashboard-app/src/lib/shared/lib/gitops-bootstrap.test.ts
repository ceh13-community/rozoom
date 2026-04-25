import { describe, expect, it } from "vitest";
import {
  getBootstrapSteps,
  generateArgoCDAppYaml,
  generateFluxGitRepositoryYaml,
  generateFluxKustomizationYaml,
  sanitizeResourceYamlForEdit,
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
    it("returns 1 install step for ArgoCD", () => {
      const steps = getBootstrapSteps(argoConfig);
      expect(steps).toHaveLength(1);
      expect(steps[0]?.id).toBe("argocd-install");
    });

    it("returns 1 install step for Flux", () => {
      const steps = getBootstrapSteps(fluxConfig);
      expect(steps).toHaveLength(1);
      expect(steps[0]?.id).toBe("flux-install");
    });

    it("uses default branch and path", () => {
      const steps = getBootstrapSteps({ provider: "argocd", repoUrl: "https://example.com/repo" });
      expect(steps).toHaveLength(1);
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

  describe("sanitizeResourceYamlForEdit", () => {
    const fullYaml = `apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  annotations:
    argocd-image-updater.argoproj.io/image-list: backend=example/backend
    kubectl.kubernetes.io/last-applied-configuration: |
      {"spec":{}}
  creationTimestamp: "2025-05-06T10:14:18Z"
  finalizers:
    - resources-finalizer.argocd.argoproj.io/projects
  generation: 3292264
  name: env-back-test
  namespace: argocd
  resourceVersion: "208287676"
  uid: 88cdf56b-3747-4e0d-9d27-c3117ff93bba
  managedFields:
    - manager: argocd-server
spec:
  project: backend-test
  source:
    repoURL: git@bitbucket.org:kcsys/acteria-helm-charts.git
    targetRevision: dev
status:
  health:
    status: Healthy
  sync:
    status: Unknown
`;

    it("removes status and cluster-managed metadata", () => {
      const cleaned = sanitizeResourceYamlForEdit(fullYaml);
      expect(cleaned).not.toContain("status:");
      expect(cleaned).not.toContain("managedFields");
      expect(cleaned).not.toContain("creationTimestamp");
      expect(cleaned).not.toContain("resourceVersion");
      expect(cleaned).not.toContain("generation:");
      expect(cleaned).not.toContain("uid:");
      expect(cleaned).not.toContain("last-applied-configuration");
    });

    it("preserves spec, name, namespace, finalizers, and user annotations", () => {
      const cleaned = sanitizeResourceYamlForEdit(fullYaml);
      expect(cleaned).toContain("name: env-back-test");
      expect(cleaned).toContain("namespace: argocd");
      expect(cleaned).toContain("resources-finalizer.argocd.argoproj.io/projects");
      expect(cleaned).toContain("argocd-image-updater.argoproj.io/image-list");
      expect(cleaned).toContain("repoURL: git@bitbucket.org:kcsys/acteria-helm-charts.git");
    });

    it("drops empty annotations block when only noise remained", () => {
      const yaml = `apiVersion: v1
kind: ConfigMap
metadata:
  name: demo
  namespace: default
  annotations:
    kubectl.kubernetes.io/last-applied-configuration: '{}'
data:
  key: value
`;
      const cleaned = sanitizeResourceYamlForEdit(yaml);
      expect(cleaned).not.toContain("annotations:");
      expect(cleaned).toContain("data:");
    });

    it("returns input unchanged when YAML is invalid", () => {
      const invalid = "::::not-yaml";
      expect(sanitizeResourceYamlForEdit(invalid)).toBe(invalid);
    });

    it("returns input unchanged for empty input", () => {
      expect(sanitizeResourceYamlForEdit("")).toBe("");
    });
  });
});
