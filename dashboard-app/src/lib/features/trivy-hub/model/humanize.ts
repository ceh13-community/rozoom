export interface HumanizedTrivyError {
  title: string;
  hint: string | null;
  category:
    | "rbac"
    | "network"
    | "crd"
    | "helm"
    | "timeout"
    | "image"
    | "disk"
    | "db"
    | "webhook"
    | "unknown";
}

export function humanizeTrivyError(raw: string): HumanizedTrivyError {
  const lower = raw.toLowerCase();

  if (
    lower.includes("forbidden") ||
    lower.includes("unauthorized") ||
    lower.includes("cannot create resource") ||
    lower.includes("cannot list resource") ||
    lower.includes("system:unauthenticated")
  ) {
    return {
      title: "RBAC denied the install or scan",
      hint: "Trivy Operator install needs cluster-admin (CRDs, ClusterRole, operator Deployment). For day-2 scans a namespace-scoped role is enough.",
      category: "rbac",
    };
  }

  if (
    lower.includes("no matches for kind") ||
    lower.includes("doesn't have a resource type") ||
    lower.includes("the server could not find the requested resource")
  ) {
    return {
      title: "Trivy Operator CRDs are not installed",
      hint: "Install the operator first. Expected CRDs: vulnerabilityreports, configauditreports, exposedsecretreports, sbomreports under aquasecurity.github.io. Wait 15-30 seconds after install for CRDs to register.",
      category: "crd",
    };
  }

  if (
    lower.includes("failed to download db") ||
    lower.includes("trivy-db") ||
    (lower.includes("failed to unmarshal") && lower.includes("trivy"))
  ) {
    return {
      title: "Trivy CVE database update failed",
      hint: "Trivy downloads its CVE DB on first run from ghcr.io. In airgapped clusters, mirror the DB and set `trivy.dbRepository=<your-registry>` in Helm values. Also verify egress to ghcr.io and aquasec.github.io.",
      category: "db",
    };
  }

  if (
    lower.includes("image pull") ||
    lower.includes("imagepullbackoff") ||
    lower.includes("errimagepull")
  ) {
    return {
      title: "Node cannot pull the Trivy image",
      hint: "Operator image lives on ghcr.io/aquasecurity/trivy-operator; trivy scanner on ghcr.io/aquasecurity/trivy. For airgapped clusters, mirror both and override `image.repository` + `trivy.image.repository` via Helm values.",
      category: "image",
    };
  }

  if (
    lower.includes("no space left") ||
    lower.includes("disk pressure") ||
    (lower.includes("crashloopbackoff") && lower.includes("trivy"))
  ) {
    return {
      title: "Trivy ran out of disk space",
      hint: "Trivy caches image layers and the CVE DB on the node PVC. Increase `trivy.storageSize` or move cache to emptyDir with larger ephemeral-storage limit.",
      category: "disk",
    };
  }

  if (
    lower.includes("dial tcp") ||
    lower.includes("no route to host") ||
    lower.includes("connection refused") ||
    lower.includes("i/o timeout")
  ) {
    return {
      title: "Network error reaching Trivy services",
      hint: "Trivy needs egress to ghcr.io (DB + images) and aquasec.github.io. Check node firewall, egress NetworkPolicy, and corporate proxy settings.",
      category: "network",
    };
  }

  if (lower.includes("timeout") || lower.includes("deadline exceeded")) {
    return {
      title: "Install or scan timed out",
      hint: "Helm default is 5m; first-run Trivy scans can take 10-15m while DB and image cache build. Pass `--timeout 15m` or retry after initial settling.",
      category: "timeout",
    };
  }

  if (
    lower.includes("release") &&
    (lower.includes("already exists") || lower.includes("cannot reuse"))
  ) {
    return {
      title: "A previous trivy-operator release is blocking install",
      hint: "Run `helm uninstall trivy-operator -n trivy-system` and delete leftover CRDs before retrying.",
      category: "helm",
    };
  }

  if (lower.includes("webhook") && (lower.includes("failed") || lower.includes("denied"))) {
    return {
      title: "Admission webhook rejected Trivy resources",
      hint: "Kyverno / Gatekeeper / OPA may block the scanner pods (they run with host mounts). Allow the trivy-system namespace or add an explicit exception for trivy-operator.",
      category: "webhook",
    };
  }

  return { title: "Trivy action failed", hint: null, category: "unknown" };
}
