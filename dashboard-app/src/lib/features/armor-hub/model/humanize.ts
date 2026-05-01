export interface HumanizedError {
  title: string;
  hint: string | null;
  category: "kernel" | "rbac" | "network" | "crd" | "helm" | "timeout" | "unknown";
}

export function humanizeArmorError(raw: string): HumanizedError {
  const lower = raw.toLowerCase();

  if (
    lower.includes("bpf-lsm") ||
    lower.includes("lsm=bpf") ||
    lower.includes("bpf lsm") ||
    lower.includes("lockdown")
  ) {
    return {
      title: "BPF-LSM is not enabled on the node kernel",
      hint: "KubeArmor defaults to BPF-LSM. Enable via kernel boot flag `lsm=bpf,lockdown,yama,integrity,apparmor` (or AppArmor enforce) and reboot the node. Alternatively install kubearmor with `--set environment.name=generic` for fallback enforcement.",
      category: "kernel",
    };
  }
  if (
    lower.includes("apparmor") &&
    (lower.includes("unable") || lower.includes("not enabled") || lower.includes("not available"))
  ) {
    return {
      title: "AppArmor is not enforcing on the node",
      hint: "KubeArmor falls back to AppArmor when BPF-LSM is missing. Ensure `apparmor_parser` is installed and `/sys/kernel/security/apparmor/enabled` is `Y`. Ubuntu/Debian nodes typically have it; other distros may not.",
      category: "kernel",
    };
  }
  if (
    lower.includes("kernel version") ||
    lower.includes("kernel too old") ||
    (lower.includes("kernel") && lower.includes("unsupported"))
  ) {
    return {
      title: "Node kernel is too old for KubeArmor BPF-LSM",
      hint: "KubeArmor requires kernel 5.8+ for full BPF-LSM. On older kernels use `--set environment.name=generic` to enable visibility-only mode, or upgrade node kernels.",
      category: "kernel",
    };
  }

  if (
    lower.includes("forbidden") ||
    lower.includes("unauthorized") ||
    lower.includes("system:unauthenticated") ||
    lower.includes("cannot create resource")
  ) {
    return {
      title: "RBAC denied the install/apply",
      hint: "Helm install creates cluster-scoped resources (CRDs, ClusterRole, DaemonSet). Your kubeconfig needs cluster-admin or equivalent for the install. For day-2 ops, a reader role is enough.",
      category: "rbac",
    };
  }

  if (
    lower.includes("no matches for kind") ||
    lower.includes("doesn't have a resource type") ||
    lower.includes("the server could not find the requested resource")
  ) {
    return {
      title: "KubeArmor CRDs are not installed on this cluster",
      hint: "Install the operator/chart first. If you just installed, wait 10-30 seconds for CRDs to register then retry.",
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
      title: "Network error pulling the KubeArmor image",
      hint: "Check node egress to docker.io / quay.io (KubeArmor images live on docker.io/kubearmor). If you run an air-gapped cluster, mirror the images to an internal registry and set `--set image.registry=<internal>`.",
      category: "network",
    };
  }

  if (lower.includes("timeout") || lower.includes("deadline exceeded")) {
    return {
      title: "Install/scan timed out",
      hint: "Helm default timeout is 5m. Large or slow clusters may need `--timeout 10m`. For scans, narrow the inspection or retry after the DaemonSet has fully rolled out.",
      category: "timeout",
    };
  }

  if (
    lower.includes("release") &&
    (lower.includes("already exists") || lower.includes("cannot reuse"))
  ) {
    return {
      title: "A previous KubeArmor release is blocking install",
      hint: "Run `helm uninstall kubearmor-operator -n kubearmor` and delete lingering CRDs if needed, then retry install.",
      category: "helm",
    };
  }

  if (lower.includes("webhook") && lower.includes("failed")) {
    return {
      title: "Admission webhook rejected KubeArmor resources",
      hint: "A Pod Security Admission or policy engine (Kyverno / Gatekeeper) may be rejecting the privileged DaemonSet. KubeArmor requires hostPID + privileged; allow kubearmor namespace or label it privileged.",
      category: "rbac",
    };
  }

  return { title: "KubeArmor action failed", hint: null, category: "unknown" };
}
