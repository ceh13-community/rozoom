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
  metadata?: { name?: string; namespace?: string };
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

async function checkService(
  clusterId: string,
  namespace: string,
  matchFn: (name: string) => boolean,
  title: string,
  id: string,
): Promise<PreflightCheck> {
  const items = await kubectlGet(clusterId, ["get", "services", "-n", namespace, "-o", "json"]);
  if (items === null) {
    return { id, title, status: "unknown", detail: `Cannot list services in ${namespace}` };
  }
  const match = items.find((svc) => matchFn(svc.metadata?.name ?? ""));
  if (!match) {
    return {
      id,
      title,
      status: "fail",
      detail: `No service with ${title.toLowerCase()} in namespace '${namespace}'`,
    };
  }
  return {
    id,
    title,
    status: "ok",
    detail: `Service ${match.metadata?.name} found in ${namespace}`,
  };
}

async function checkCrd(
  clusterId: string,
  crdName: string,
  title: string,
  id: string,
): Promise<PreflightCheck> {
  const res = await kubectlRawArgsFront(["get", "crd", crdName, "-o", "json"], { clusterId });
  if (res.code === 0 && !res.errors) {
    return { id, title, status: "ok", detail: "CRD present" };
  }
  return {
    id,
    title,
    status: "warn",
    detail: "Not installed - rules/silences management from UI will not work",
  };
}

async function checkCanCreateSilence(clusterId: string): Promise<PreflightCheck> {
  // Use kubectl auth can-i for the monitoring.coreos.com silences equivalent
  // Silence is an Alertmanager API concept (not a CRD), so we check whether the
  // user can proxy to the alertmanager service instead.
  const res = await kubectlRawArgsFront(
    ["auth", "can-i", "get", "services/proxy", "-n", "monitoring"],
    { clusterId },
  );
  if (res.code === 0 && !res.errors) {
    return {
      id: "silence-rbac",
      title: "Silence RBAC",
      status: "ok",
      detail: "User can proxy to services in monitoring namespace",
    };
  }
  return {
    id: "silence-rbac",
    title: "Silence RBAC",
    status: "warn",
    detail:
      "User may not be able to proxy to Alertmanager. Creating silences from UI may fail; use kubectl port-forward or a service-account token.",
  };
}

async function findMonitoringNamespace(clusterId: string): Promise<string | null> {
  // Look up Helm release label or common namespaces
  const items = await kubectlGet(clusterId, ["get", "namespaces", "-o", "json"]);
  if (items === null) return null;
  const common = ["monitoring", "prometheus", "kube-prometheus-stack", "observability"];
  for (const name of common) {
    if (items.some((ns) => ns.metadata?.name === name)) return name;
  }
  return null;
}

function combineOverall(checks: PreflightCheck[]): PreflightStatus {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  if (checks.every((c) => c.status === "ok")) return "ok";
  return "unknown";
}

export async function runPreflight(clusterId: string): Promise<PreflightReport> {
  const namespace = (await findMonitoringNamespace(clusterId)) ?? "monitoring";

  const checks = await Promise.all([
    checkService(
      clusterId,
      namespace,
      (n) => n.toLowerCase().includes("alertmanager"),
      "Alertmanager Service",
      "alertmanager-svc",
    ),
    checkService(
      clusterId,
      namespace,
      (n) => n.toLowerCase().includes("prometheus") && !n.toLowerCase().includes("operator"),
      "Prometheus Service",
      "prometheus-svc",
    ),
    checkCrd(
      clusterId,
      "prometheusrules.monitoring.coreos.com",
      "PrometheusRule CRD",
      "prometheus-rule-crd",
    ),
    checkCrd(
      clusterId,
      "alertmanagers.monitoring.coreos.com",
      "Alertmanager CRD",
      "alertmanager-crd",
    ),
    checkCanCreateSilence(clusterId),
  ]);

  return { overall: combineOverall(checks), checks, ranAt: Date.now() };
}
