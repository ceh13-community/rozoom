export type GitOpsProvider = "argocd" | "flux";

export type GitOpsBootstrapConfig = {
  provider: GitOpsProvider;
  repoUrl: string;
  branch?: string;
  path?: string;
  namespace?: string;
};

export type BootstrapStep = {
  id: string;
  label: string;
  command: string[];
};

export function getBootstrapSteps(config: GitOpsBootstrapConfig): BootstrapStep[] {
  const branch = config.branch ?? "main";
  const path = config.path ?? ".";

  if (config.provider === "argocd") {
    return getArgoCDSteps(config.repoUrl, branch, path, config.namespace ?? "argocd");
  }

  return getFluxSteps(config.repoUrl, branch, path, config.namespace ?? "flux-system");
}

function getArgoCDSteps(
  repoUrl: string,
  branch: string,
  path: string,
  namespace: string,
): BootstrapStep[] {
  return [
    {
      id: "argocd-install",
      label: "Install ArgoCD via Helm",
      command: [
        "helm",
        "upgrade",
        "--install",
        "argocd",
        "argo/argo-cd",
        "--namespace",
        namespace,
        "--create-namespace",
        "--wait",
        "--timeout",
        "5m",
      ],
    },
    {
      id: "argocd-app",
      label: "Create ArgoCD Application",
      command: ["kubectl", "apply", "-f", "-"],
    },
  ];
}

function getFluxSteps(
  repoUrl: string,
  branch: string,
  path: string,
  namespace: string,
): BootstrapStep[] {
  return [
    {
      id: "flux-install",
      label: "Install Flux via Helm",
      command: [
        "helm",
        "upgrade",
        "--install",
        "flux",
        "fluxcd-community/flux2",
        "--namespace",
        namespace,
        "--create-namespace",
        "--wait",
        "--timeout",
        "5m",
      ],
    },
    {
      id: "flux-source",
      label: "Create GitRepository source",
      command: ["kubectl", "apply", "-f", "-"],
    },
    {
      id: "flux-kustomization",
      label: "Create Flux Kustomization",
      command: ["kubectl", "apply", "-f", "-"],
    },
  ];
}

export function generateArgoCDAppYaml(config: GitOpsBootstrapConfig): string {
  const branch = config.branch ?? "main";
  const path = config.path ?? ".";
  const namespace = config.namespace ?? "argocd";

  return `apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: cluster-apps
  namespace: ${namespace}
spec:
  project: default
  source:
    repoURL: ${config.repoUrl}
    targetRevision: ${branch}
    path: ${path}
  destination:
    server: https://kubernetes.default.svc
    namespace: default
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true`;
}

export function generateFluxGitRepositoryYaml(config: GitOpsBootstrapConfig): string {
  const branch = config.branch ?? "main";
  const namespace = config.namespace ?? "flux-system";

  return `apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: cluster-apps
  namespace: ${namespace}
spec:
  interval: 1m
  ref:
    branch: ${branch}
  url: ${config.repoUrl}`;
}

export function generateFluxKustomizationYaml(config: GitOpsBootstrapConfig): string {
  const path = config.path ?? ".";
  const namespace = config.namespace ?? "flux-system";

  return `apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: cluster-apps
  namespace: ${namespace}
spec:
  interval: 10m
  targetNamespace: default
  sourceRef:
    kind: GitRepository
    name: cluster-apps
  path: ${path}
  prune: true`;
}
