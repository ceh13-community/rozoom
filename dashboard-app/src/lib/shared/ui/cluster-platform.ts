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

/**
 * User-facing short name for a cluster, used as the primary label on
 * cluster cards, sidebar entries, and breadcrumbs.
 *
 * Preference order:
 *   1. explicit `displayName` if set by the user in Cluster Manager
 *   2. trailing `cluster/<name>` segment for EKS ARNs (so
 *      "arn:aws:eks:us-east-1:...:cluster/prod-7env" renders as
 *      "prod-7env" instead of the 60-char ARN truncated with ellipsis)
 *   3. trailing segment for GKE context names ("gke_project_region_name"
 *      -> "name")
 *   4. the raw cluster name as a fallback
 *
 * Keep in sync with callers that surface the full name as a tooltip /
 * aria-label (pass the original `cluster.name` as `title` so the full
 * ARN stays accessible on hover and via screen readers).
 */
export function resolveClusterDisplayName(cluster: {
  name?: string | null;
  displayName?: string | null;
}): string {
  const explicit = cluster.displayName?.trim();
  if (explicit) return explicit;
  const name = cluster.name?.trim() ?? "";
  if (!name) return "";
  const eksMatch = name.match(/^arn:aws:eks:[^:]+:[^:]+:cluster\/(.+)$/);
  if (eksMatch && eksMatch[1]) return eksMatch[1];
  if (name.startsWith("gke_")) {
    const parts = name.split("_");
    if (parts.length >= 4 && parts[parts.length - 1]) {
      return parts[parts.length - 1];
    }
  }
  return name;
}
