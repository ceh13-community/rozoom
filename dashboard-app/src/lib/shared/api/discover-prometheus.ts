import { kubectlJson } from "$shared/api/kubectl-proxy";
import type { BaseClusterData, ServiceItem } from "../model/clusters";

export type PrometheusTarget = {
  name: string;
  namespace: string;
  port: number;
};

function lower(target: string | undefined): string {
  return (target ?? "").toLowerCase();
}

function looksLikePrometheus(svc: ServiceItem): boolean {
  const name = lower(svc.metadata.name);
  const ns = lower(svc.metadata.namespace);
  const labels = svc.metadata.labels ?? {};

  const labelName = lower(labels["app.kubernetes.io/name"]);
  const labelApp = lower(labels["app"]);
  const labelInst = lower(labels["app.kubernetes.io/instance"]);

  const byName =
    name === "prometheus" ||
    name.includes("prometheus") ||
    name.includes("kube-prometheus") ||
    name.includes("kps");

  const byLabels =
    labelName.includes("prometheus") ||
    labelApp.includes("prometheus") ||
    labelInst.includes("prometheus");

  const byNs = ns === "monitoring" || ns === "kps" || ns.includes("monitor");

  return (byName || byLabels) && (byNs || byName || byLabels);
}

function score(svc: ServiceItem): number {
  const name = lower(svc.metadata.name);
  const ns = lower(svc.metadata.namespace);

  let scoreResult = 0;

  if (ns === "monitoring") scoreResult += 50;
  if (ns === "kps") scoreResult += 45;
  if (name === "prometheus") scoreResult += 80;
  if (name.includes("kps-prometheus")) scoreResult += 70;
  if (name.includes("kube-prometheus")) scoreResult += 65;
  if (name.includes("prometheus")) scoreResult += 40;

  const ports = svc.spec.ports;

  if (ports.some((p) => p.port === 9090)) scoreResult += 60;

  if (name.includes("operated")) scoreResult -= 20;

  return scoreResult;
}

function pickPort(svc: ServiceItem): number {
  const ports = svc.spec.ports;
  const p9090 = ports.find((p) => p.port === 9090);

  if (p9090) return p9090.port;

  const pWeb = ports.find((p) => lower(p.name) === "web");

  if (pWeb) return pWeb.port;

  return ports[0]?.port ?? 9090;
}

export async function discoverPrometheusService(
  clusterId: string,
): Promise<PrometheusTarget | null> {
  const svcs = await kubectlJson<BaseClusterData<ServiceItem>>("get svc -A", { clusterId });

  if (typeof svcs === "string") return null;

  const items = svcs.items;
  const candidates = items.filter(looksLikePrometheus);

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => score(b) - score(a));
  const pick = candidates[0];

  const ns = pick.metadata.namespace ? pick.metadata.namespace : "default";

  return {
    name: pick.metadata.name,
    namespace: ns,
    port: pickPort(pick),
  };
}
