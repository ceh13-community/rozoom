export interface HumanizedComplianceError {
  title: string;
  hint: string | null;
  category: "psa" | "rbac" | "network" | "crd" | "helm" | "timeout" | "hostpath" | "unknown";
}

export function humanizeComplianceError(raw: string): HumanizedComplianceError {
  const lower = raw.toLowerCase();

  if (
    lower.includes("pod security") ||
    lower.includes("podsecurity") ||
    lower.includes("violates podsecurity") ||
    (lower.includes("restricted") && lower.includes("privileged"))
  ) {
    return {
      title: "PodSecurity Admission rejected the scan workload",
      hint: "kube-bench Job needs hostPID + hostPath + privileged; Kubescape scanner needs host mounts. Allow this via a namespace label: `kubectl label namespace <ns> pod-security.kubernetes.io/enforce=privileged` or use a namespace exempt from PodSecurity policies.",
      category: "psa",
    };
  }

  if (
    lower.includes("forbidden") ||
    lower.includes("unauthorized") ||
    lower.includes("cannot create resource") ||
    lower.includes("system:unauthenticated") ||
    lower.includes("cannot list resource")
  ) {
    return {
      title: "RBAC denied the install or scan",
      hint: "Kubescape install needs cluster-admin (CRDs, ClusterRole, operator). kube-bench Job needs node access. Use a kubeconfig with cluster-admin during install; for day-2 scans a namespace-scoped role is enough.",
      category: "rbac",
    };
  }

  if (
    lower.includes("hostpath") ||
    lower.includes("host path") ||
    lower.includes("volume is not allowed")
  ) {
    return {
      title: "hostPath volumes are not allowed on this cluster",
      hint: "kube-bench mounts /var, /etc, /usr/bin from the node to inspect kubelet/etcd configs. Cluster policy (OPA/Gatekeeper/Kyverno) is blocking hostPath. Add an exception for the kube-bench namespace or use a node-level scanner instead.",
      category: "hostpath",
    };
  }

  if (
    lower.includes("no matches for kind") ||
    lower.includes("doesn't have a resource type") ||
    lower.includes("crd is missing") ||
    lower.includes("the server could not find the requested resource")
  ) {
    return {
      title: "Kubescape CRDs are not installed yet",
      hint: "Install the Kubescape operator first. After install, wait 15-30 seconds for CRDs to register before triggering a scan.",
      category: "crd",
    };
  }

  if (
    lower.includes("image pull") ||
    lower.includes("imagepullbackoff") ||
    lower.includes("errimagepull") ||
    lower.includes("dial tcp") ||
    lower.includes("no route to host") ||
    lower.includes("connection refused")
  ) {
    return {
      title: "Network error pulling scanner image",
      hint: "Nodes need egress to quay.io (Kubescape) and docker.io (kube-bench). For air-gapped clusters mirror the images and override via Helm values (`image.repository=<internal>`).",
      category: "network",
    };
  }

  if (lower.includes("timeout") || lower.includes("deadline exceeded")) {
    return {
      title: "Scan timed out",
      hint: "Helm default timeout is 5m. Large clusters often need 10m+. Pass `--timeout 10m` or re-run after the initial install settles.",
      category: "timeout",
    };
  }

  if (
    lower.includes("release") &&
    (lower.includes("already exists") || lower.includes("cannot reuse"))
  ) {
    return {
      title: "A previous Kubescape release is blocking install",
      hint: "Run `helm uninstall kubescape -n kubescape` and delete any leftover CRDs, then retry.",
      category: "helm",
    };
  }

  if (lower.includes("webhook") && lower.includes("failed")) {
    return {
      title: "Admission webhook rejected the resources",
      hint: "Kyverno / Gatekeeper / OPA may deny privileged workloads. Allow the kubescape and kube-system namespaces, or use policy exceptions during scans.",
      category: "psa",
    };
  }

  return { title: "Compliance scan failed", hint: null, category: "unknown" };
}
