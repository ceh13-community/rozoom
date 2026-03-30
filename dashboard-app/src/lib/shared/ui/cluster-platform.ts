import { detectClusterProvider, type ClusterProvider } from "$shared/lib/provider-detection";

export type ClusterPlatformLabel =
  | "Bare metal"
  | "RKE"
  | "K3s"
  | "EKS"
  | "GKE"
  | "AKS"
  | "DigitalOcean"
  | "OKE"
  | "OpenShift"
  | "Minikube"
  | "Kind"
  | "K3d"
  | "Docker Desktop"
  | "Rancher Desktop"
  | "Colima"
  | "Hetzner"
  | "Custom";

const PROVIDER_TO_LABEL: Partial<Record<ClusterProvider, ClusterPlatformLabel>> = {
  "AWS EKS": "EKS",
  GKE: "GKE",
  AKS: "AKS",
  DigitalOcean: "DigitalOcean",
  Hetzner: "Hetzner",
  OKE: "OKE",
  OpenShift: "OpenShift",
  RKE: "RKE",
  K3s: "K3s",
  Minikube: "Minikube",
  Kind: "Kind",
  K3d: "K3d",
  "Docker Desktop": "Docker Desktop",
  "Rancher Desktop": "Rancher Desktop",
  Colima: "Colima",
  "Bare metal": "Bare metal",
};

export const getClusterPlatformLabel = (name?: string | null): ClusterPlatformLabel => {
  if (!name) return "Custom";
  const result = detectClusterProvider({ clusterName: name });
  return PROVIDER_TO_LABEL[result.provider] ?? "Custom";
};
