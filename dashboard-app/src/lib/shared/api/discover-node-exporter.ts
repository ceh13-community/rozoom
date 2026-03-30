import { kubectlJson } from "$shared/api/kubectl-proxy";
import type { MetaData, PodItem, ServiceItem } from "../model/clusters";

function hasNodeExporterHint(meta?: MetaData): boolean {
  const name = (meta?.name ?? "").toLowerCase();
  const labels = meta?.labels ?? {};
  const labelValues = Object.values(labels).join(" ").toLowerCase();

  return (
    name.includes("node-exporter") ||
    labelValues.includes("node-exporter") ||
    labelValues.includes("prometheus-node-exporter")
  );
}

export async function discoverNodeExporterPodForNode(
  clusterId: string,
  nodeName: string,
): Promise<{ namespace: string; podName: string } | null> {
  const podsAny = await kubectlJson<{ items?: PodItem[] }>("get pods -A", { clusterId });
  if (typeof podsAny === "string") return null;

  const pods = podsAny.items ?? [];

  // 1) Prefer pods on the target node with node-exporter hints
  const candidates = pods.filter((p) => {
    const meta = p.metadata;
    const ns = meta.namespace;
    const name = meta.name;

    return (
      p.spec.nodeName === nodeName &&
      hasNodeExporterHint(meta) &&
      typeof ns === "string" &&
      ns.length > 0 &&
      typeof name === "string" &&
      name.length > 0
    );
  });

  if (candidates.length > 0) {
    const best =
      candidates.find((p) => p.metadata.namespace === "monitoring") ??
      candidates.find((p) => p.metadata.namespace === "kps") ??
      candidates[0];

    const ns = best.metadata.namespace;
    const name = best.metadata.name;

    if (typeof ns === "string" && typeof name === "string") {
      return { namespace: ns, podName: name };
    }
  }

  // 2) Fallback: try to find a service for node-exporter and then find matching pods by selector on the node
  const svcsAny = await kubectlJson<{ items?: ServiceItem[] }>("get svc -A", { clusterId });

  if (typeof svcsAny === "string") return null;

  const svcs = (svcsAny.items ?? []).filter((s) => {
    const ports = s.spec.ports;
    return hasNodeExporterHint(s.metadata) && ports.some((p) => p.port === 9100);
  });

  if (svcs.length === 0) return null;

  const svc = svcs[0];
  const svcNs = svc.metadata.namespace;

  if (typeof svcNs !== "string" || svcNs.length === 0) return null;

  const selector = svc.spec.selector ?? {};
  const selectorParts = Object.entries(selector).map(([k, v]) => `${k}=${v}`);

  if (selectorParts.length === 0) return null;

  const selectorExpr = selectorParts.join(",");
  const podsSelAny = await kubectlJson<{ items?: PodItem[] }>(
    `get pods -n ${svcNs} -l ${selectorExpr}`,
    { clusterId },
  );

  if (typeof podsSelAny === "string") return null;

  const podsSel = podsSelAny.items ?? [];
  const podOnNode = podsSel.find((p) => p.spec.nodeName === nodeName);

  const podNs = podOnNode?.metadata.namespace;
  const podName = podOnNode?.metadata.name;

  if (
    typeof podNs === "string" &&
    podNs.length > 0 &&
    typeof podName === "string" &&
    podName.length > 0
  ) {
    return { namespace: podNs, podName };
  }

  return null;
}
