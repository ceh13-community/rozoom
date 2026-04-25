import { load as parseYaml, dump as dumpYaml } from "js-yaml";

export type GitOpsProvider = "argocd" | "flux";

const STRIPPED_METADATA_FIELDS = [
  "creationTimestamp",
  "generation",
  "resourceVersion",
  "selfLink",
  "uid",
  "managedFields",
  "ownerReferences",
];

const STRIPPED_ANNOTATION_KEYS = ["kubectl.kubernetes.io/last-applied-configuration"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeResourceYamlForEdit(rawYaml: string): string {
  if (!rawYaml.trim()) return rawYaml;
  let parsed: unknown;
  try {
    parsed = parseYaml(rawYaml);
  } catch {
    return rawYaml;
  }
  if (!isPlainObject(parsed)) return rawYaml;

  delete parsed.status;

  const metadata = parsed.metadata;
  if (isPlainObject(metadata)) {
    for (const key of STRIPPED_METADATA_FIELDS) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete metadata[key];
    }
    const annotations = metadata.annotations;
    if (isPlainObject(annotations)) {
      for (const key of STRIPPED_ANNOTATION_KEYS) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete annotations[key];
      }
      if (Object.keys(annotations).length === 0) delete metadata.annotations;
    }
  }

  try {
    return dumpYaml(parsed, { lineWidth: -1, noRefs: true, sortKeys: false });
  } catch {
    return rawYaml;
  }
}

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
  _repoUrl: string,
  _branch: string,
  _path: string,
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
  ];
}

function getFluxSteps(
  _repoUrl: string,
  _branch: string,
  _path: string,
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
