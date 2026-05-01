import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";

export type PreflightStatus = "ok" | "warn" | "fail" | "unknown";

export interface PreflightCheck {
  id: string;
  title: string;
  status: PreflightStatus;
  detail: string;
}

export interface PreflightReport {
  overall: PreflightStatus;
  checks: PreflightCheck[];
  ranAt: number;
}

interface K8sItem {
  metadata?: { name?: string; namespace?: string; labels?: Record<string, string> };
  status?: {
    phase?: string;
    desiredNumberScheduled?: number;
    numberReady?: number;
  };
}

async function kubectlGet(clusterId: string, args: string[]): Promise<K8sItem[] | null> {
  const res = await kubectlRawArgsFront(args, { clusterId });
  if (res.errors || res.code !== 0) return null;
  try {
    const parsed = JSON.parse(res.output) as { items?: K8sItem[] };
    return parsed.items ?? [];
  } catch {
    return null;
  }
}

async function checkNodeCount(clusterId: string): Promise<PreflightCheck> {
  const items = await kubectlGet(clusterId, ["get", "nodes", "-o", "json"]);
  if (items === null) {
    return { id: "nodes", title: "Node access", status: "fail", detail: "Cannot list nodes" };
  }
  return {
    id: "nodes",
    title: "Node access",
    status: items.length > 0 ? "ok" : "fail",
    detail: `${items.length} nodes visible`,
  };
}

async function checkKubeletTls(clusterId: string): Promise<PreflightCheck> {
  // Heuristic: many local clusters (minikube, kind, k3s) have kubelet certs
  // without IP SANs. We detect that by checking the cluster type via node
  // labels / providerID.
  const items = await kubectlGet(clusterId, ["get", "nodes", "-o", "json"]);
  if (items === null) {
    return {
      id: "kubelet-tls",
      title: "Kubelet TLS / IP SANs",
      status: "unknown",
      detail: "Cannot list nodes",
    };
  }
  const first = items[0];
  const firstProvider =
    (first as unknown as { spec?: { providerID?: string } }).spec?.providerID ?? "";
  const labels = first.metadata?.labels ?? {};
  const nodeName = (first.metadata?.name ?? "").toLowerCase();
  const isLocal =
    !firstProvider ||
    firstProvider.startsWith("kind://") ||
    firstProvider.startsWith("k3s://") ||
    firstProvider.startsWith("docker://") ||
    nodeName.startsWith("minikube") ||
    nodeName.includes("k3d") ||
    !!labels["kind.x-k8s.io/cluster"];
  if (isLocal) {
    return {
      id: "kubelet-tls",
      title: "Kubelet TLS / IP SANs",
      status: "warn",
      detail:
        "Local-dev cluster detected (minikube/kind/k3s). Kubelet cert often lacks IP SANs - metrics-server typically needs --kubelet-insecure-tls here.",
    };
  }
  return {
    id: "kubelet-tls",
    title: "Kubelet TLS / IP SANs",
    status: "ok",
    detail: "Managed/cloud cluster - kubelet certs usually include IP SANs",
  };
}

async function checkPsaLabels(clusterId: string): Promise<PreflightCheck> {
  const items = await kubectlGet(clusterId, ["get", "namespaces", "-o", "json"]);
  if (items === null) {
    return {
      id: "psa",
      title: "PodSecurity Admission",
      status: "unknown",
      detail: "Cannot list namespaces",
    };
  }
  const problem: string[] = [];
  for (const ns of items) {
    const labels = ns.metadata?.labels ?? {};
    const enforce = labels["pod-security.kubernetes.io/enforce"];
    const name = ns.metadata?.name ?? "";
    if (enforce === "restricted" && ["kube-system", "monitoring"].includes(name)) {
      problem.push(`${name}=restricted`);
    }
  }
  if (problem.length > 0) {
    return {
      id: "psa",
      title: "PodSecurity Admission",
      status: "fail",
      detail: `Namespaces with restricted enforcement: ${problem.join(", ")}. node-exporter (privileged) will be blocked.`,
    };
  }
  return {
    id: "psa",
    title: "PodSecurity Admission",
    status: "ok",
    detail: "No blocking PSA labels on install namespaces",
  };
}

async function checkDaemonSetCoverage(clusterId: string): Promise<PreflightCheck> {
  // Two label values in the wild: the standalone chart and older installs
  // use `app.kubernetes.io/name=node-exporter`, while the subchart in
  // kube-prometheus-stack uses `app.kubernetes.io/name=prometheus-node-exporter`.
  // A single label selector with `in (...)` matches both without two round-trips.
  const items = await kubectlGet(clusterId, [
    "get",
    "daemonset",
    "-A",
    "-l",
    "app.kubernetes.io/name in (node-exporter, prometheus-node-exporter)",
    "-o",
    "json",
  ]);
  if (items === null || items.length === 0) {
    return {
      id: "ds-coverage",
      title: "node-exporter DaemonSet",
      status: "warn",
      detail: "Not installed yet",
    };
  }
  const ds = items[0];
  const desired = ds.status?.desiredNumberScheduled ?? 0;
  const ready = ds.status?.numberReady ?? 0;
  if (desired === 0) {
    return {
      id: "ds-coverage",
      title: "node-exporter DaemonSet",
      status: "warn",
      detail: "DaemonSet exists but schedules 0 pods (tolerations issue?)",
    };
  }
  if (ready < desired) {
    return {
      id: "ds-coverage",
      title: "node-exporter DaemonSet",
      status: "fail",
      detail: `${ready}/${desired} pods ready`,
    };
  }
  return {
    id: "ds-coverage",
    title: "node-exporter DaemonSet",
    status: "ok",
    detail: `${ready}/${desired} pods ready on all nodes`,
  };
}

async function checkMetricsServerDeployment(clusterId: string): Promise<PreflightCheck> {
  const items = await kubectlGet(clusterId, [
    "get",
    "deployment",
    "-n",
    "kube-system",
    "-l",
    "k8s-app=metrics-server",
    "-o",
    "json",
  ]);
  if (items === null || items.length === 0) {
    return {
      id: "ms-deploy",
      title: "metrics-server Deployment",
      status: "warn",
      detail: "Not installed in kube-system (may be elsewhere)",
    };
  }
  const dep = items[0] as unknown as {
    status?: { readyReplicas?: number; replicas?: number };
  };
  const ready = dep.status?.readyReplicas ?? 0;
  const replicas = dep.status?.replicas ?? 0;
  if (ready < replicas) {
    return {
      id: "ms-deploy",
      title: "metrics-server Deployment",
      status: "fail",
      detail: `${ready}/${replicas} replicas ready`,
    };
  }
  return {
    id: "ms-deploy",
    title: "metrics-server Deployment",
    status: "ok",
    detail: `${ready}/${replicas} replicas ready`,
  };
}

function combineOverall(checks: PreflightCheck[]): PreflightStatus {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  if (checks.every((c) => c.status === "ok")) return "ok";
  return "unknown";
}

export async function runPreflight(clusterId: string): Promise<PreflightReport> {
  const checks = await Promise.all([
    checkNodeCount(clusterId),
    checkKubeletTls(clusterId),
    checkPsaLabels(clusterId),
    checkDaemonSetCoverage(clusterId),
    checkMetricsServerDeployment(clusterId),
  ]);
  return { overall: combineOverall(checks), checks, ranAt: Date.now() };
}
